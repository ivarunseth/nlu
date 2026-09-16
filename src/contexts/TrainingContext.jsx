import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "./ApiContext";
import { useSocket } from "./SocketContext";
import { UserContext } from "./UserContext";

// Live progress of every training run the signed-in user has going, for the
// strip above the footer. Seeded from GET /trainings/active on sign-in, then
// kept current over the shared socket:
//   - `training` events on the user's own room (user:<id>) say a run started
//     (so the strip subscribes to the model's room in time) or was stopped —
//     with its final status, since a stop is written by the control plane
//     and the worker pushes nothing for it;
//   - `status` events on each model:<id> room carry the run's task status,
//     its metric history and, between epochs, batch progress.
// Events missed while the socket was down (or lost to a dead worker) are
// caught by reconciling against the server on every reconnect and once a
// minute while anything is tracked. A finished run lingers for a few seconds
// so its outcome is seen, then goes.
export const TrainingContext = createContext({ trainings: [] });

const ACTIVE = ["PENDING", "RECEIVED", "STARTED"];
const DONE = ["SUCCESS", "FAILURE", "ABORTED", "REVOKED"];
const LINGER_MS = 4000;
const RECONCILE_MS = 60000;

// Fraction complete, from the per-epoch history (each epoch appends one point
// after the epoch-0 baseline) plus how far the current epoch's batches have
// got; clamped so early stopping never shows more than done.
export const trainingProgress = (run) => {
    if (DONE.includes(run.status)) return 1;
    const epochs = run.epochs || run.progress?.epochs;
    if (!epochs) return null;
    const history = run.result?.history;
    const lengths = history ? Object.values(history).filter(Array.isArray).map((s) => s.length) : [];
    const finished = Math.max(0, (lengths.length ? Math.max(...lengths) : 1) - 1);
    const batches = run.progress?.batches;
    const inEpoch = batches && run.progress.epoch > finished ? Math.min(1, run.progress.batch / batches) : 0;
    return Math.min(1, (finished + inEpoch) / epochs);
};

const fromActive = (item) => ({
    taskId: item.task_id,
    modelId: item.model_id,
    modelName: item.model_name,
    trainingId: item.id,
    version: item.version,
    status: item.status,
    epochs: item.kwargs?.epochs ?? null,
    result: item.result && typeof item.result === "object" ? item.result : null,
    progress: item.result?.progress ?? null,
    doneAt: null
});

export const TrainingProvider = ({ children }) => {
    const { user } = useContext(UserContext);
    const api = useApi();
    const socket = useSocket();
    const [runs, setRuns] = useState({});
    const runsRef = useRef(runs);
    runsRef.current = runs;

    const upsert = useCallback((taskId, patch) => {
        setRuns((previous) => ({ ...previous, [taskId]: { ...previous[taskId], ...patch } }));
    }, []);

    // Bring the tracked set in line with the server: adopt every active run
    // it reports, and resolve any tracked run it no longer lists by asking
    // for that training's final status (the event that ended it was missed).
    const reconcile = useCallback(async () => {
        try {
            const { trainings } = await api.trainings.active();
            const listed = new Set(trainings.map((item) => item.task_id));
            const stale = Object.values(runsRef.current).filter((run) => !listed.has(run.taskId) && !run.doneAt);
            const outcomes = await Promise.all(stale.map(async (run) => {
                try {
                    const training = await api.trainings.get(run.modelId, run.trainingId);
                    return [run.taskId, training.status];
                } catch {
                    return [run.taskId, "REVOKED"]; // gone (deleted) — treat as cancelled
                }
            }));
            setRuns((previous) => {
                const next = { ...previous };
                trainings.forEach((item) => {
                    next[item.task_id] = { ...next[item.task_id], ...fromActive(item) };
                });
                outcomes.forEach(([taskId, status]) => {
                    if (!next[taskId]) return;
                    const final = DONE.includes(status) ? status : "REVOKED";
                    next[taskId] = { ...next[taskId], status: final, doneAt: next[taskId].doneAt || Date.now() };
                });
                return next;
            });
        } catch (error) {
            console.error("Could not reconcile active trainings:", error);
        }
    }, [api]);

    // Seed from the server whenever the session (re)starts.
    useEffect(() => {
        if (!user) {
            setRuns({});
            return undefined;
        }
        reconcile();
        return undefined;
    }, [user, reconcile]);

    // Safety net for anything a lost event leaves behind: a periodic
    // reconcile while runs are tracked.
    const tracking = Object.keys(runs).length > 0;
    useEffect(() => {
        if (!user || !tracking) return undefined;
        const timer = setInterval(reconcile, RECONCILE_MS);
        return () => clearInterval(timer);
    }, [user, tracking, reconcile]);

    // Rooms: the user's own, plus one per model with a run in flight.
    const modelIds = useMemo(() => (
        [...new Set(Object.values(runs).filter((run) => ACTIVE.includes(run.status)).map((run) => run.modelId))].sort()
    ), [runs]);
    const modelIdsKey = modelIds.join(",");

    useEffect(() => {
        if (!user || !socket) return undefined;
        const rooms = [`user:${user.id}`, ...modelIds.map((id) => `model:${id}`)];
        const join = () => rooms.forEach((room) => socket.emit("join", user.token, room));
        // A reconnect means a gap; whatever ended or began during it is on
        // the server, not in the events we get from here on.
        const rejoin = () => {
            join();
            reconcile();
        };

        const handleTraining = (data) => {
            if (data.event === "started") {
                upsert(data.task_id, {
                    taskId: data.task_id,
                    modelId: data.model_id,
                    modelName: data.model_name,
                    trainingId: data.training_id,
                    version: data.version,
                    status: "PENDING",
                    epochs: data.epochs ?? runsRef.current[data.task_id]?.epochs ?? null,
                    result: null,
                    progress: null,
                    doneAt: null
                });
            } else if (data.event === "stopped" && runsRef.current[data.task_id]) {
                const status = DONE.includes(data.status) ? data.status : "ABORTED";
                upsert(data.task_id, { status, doneAt: Date.now() });
            }
        };

        const handleStatus = (data) => {
            const current = runsRef.current[data.task_id];
            if (!current) return; // a serving task, or a run this session isn't tracking
            const patch = {
                status: data.status,
                result: data.result && typeof data.result === "object" ? data.result : current.result,
                progress: data.result?.progress ?? current.progress
            };
            if (data.kwargs?.epochs) patch.epochs = data.kwargs.epochs;
            if (DONE.includes(data.status) && !current.doneAt) patch.doneAt = Date.now();
            upsert(data.task_id, patch);
        };

        socket.on("training", handleTraining);
        socket.on("status", handleStatus);
        socket.on("connect", rejoin);
        if (socket.connected) join();

        return () => {
            socket.off("training", handleTraining);
            socket.off("status", handleStatus);
            socket.off("connect", rejoin);
            // The user room stays for the session; model rooms are left as
            // their runs finish (the dependency change re-runs this effect).
            if (socket.connected) {
                modelIds.forEach((id) => socket.emit("leave", user.token, `model:${id}`));
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, socket, modelIdsKey, upsert, reconcile]);

    // Drop finished runs once they've lingered.
    useEffect(() => {
        const finished = Object.values(runs).filter((run) => run.doneAt);
        if (finished.length === 0) return undefined;
        const soonest = Math.min(...finished.map((run) => run.doneAt + LINGER_MS));
        const timer = setTimeout(() => {
            const cutoff = Date.now() - LINGER_MS;
            setRuns((previous) => Object.fromEntries(
                Object.entries(previous).filter(([, run]) => !(run.doneAt && run.doneAt <= cutoff))
            ));
        }, Math.max(0, soonest - Date.now()));
        return () => clearTimeout(timer);
    }, [runs]);

    const trainings = useMemo(() => (
        Object.values(runs).sort((a, b) => (a.modelName || "").localeCompare(b.modelName || "") || a.version - b.version)
    ), [runs]);

    return (
        <TrainingContext.Provider value={{ trainings }}>
            {children}
        </TrainingContext.Provider>
    );
};

export const useTrainings = () => useContext(TrainingContext).trainings;
