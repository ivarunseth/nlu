import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Form, Nav, Row, Spinner, Tab } from "react-bootstrap";
import {
    ExclamationTriangle,
    InfoCircle,
    Play,
    Braces,
    CardText,
    Cpu,
    Hdd,
    Stack,
    Stopwatch,
    Send,
    SendCheck,
    SendDash,
    SendSlash,
    SendExclamation,
    Reply,
    FolderCheck,
    Folder,
    ArrowClockwise,
    Stop,
    FilterLeft,
    Hash,
    Files,
    Collection,
    ColumnsGap,
    GripVertical,
    SortDown,
    Exclamation,
    Info
} from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import { ModelContext } from "../../../../contexts/ModelContext";
import { useSocket } from "../../../../contexts/SocketContext";
import { SectionLabel, CardHeading, EmptyState } from "../../../../shared/components/SectionCard";
import { entityColor } from "../../../../shared/components/entityColors";
import { parseApiDate } from "../../../../shared/utils/training";
import { isErrorPrediction, getLabels, getEntities, getIntents, getSlotEntities, scoresClose, PredictionView, JsonView } from "./components/Prediction";
import BatchPanel from "./components/BatchPanel";
import BatchResults from "./components/BatchResults";
import axios from "axios";

const ENVIRONMENT = "development";

// Environments the development prediction can be compared against, in
// pipeline order. Their deployments are managed from the Publish tab; here
// they are only queried, each through its own endpoint and API key.
const COMPARE_ENVIRONMENTS = ["testing", "production"];

// Batch uploads are submitted as sequential chunks of this many inputs,
// kept under the server's INFERENCE_MAX_BATCH cap so a large CSV streams
// through as a series of normal-sized requests instead of one giant push.
const BATCH_CHUNK_SIZE = 100;

// Request/response split, as the request panel's width percentage. The drag
// handle is centred on this percentage, and the bounds line up with the
// metric strip's 4-column gutters (its gaps fall at ~25% / 50% / 75%), so the
// divider visually continues one of those gaps at either extreme. 50% is a
// balanced middle default that also aligns with the strip's centre gap.
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;
// Drag-handle width; matches the metric strip's g-3 (1rem) column gutter so
// the split reads as a continuation of it.
const SPLIT_GUTTER = 16;

// Envelope keys the serving loop wraps around every prediction. They naturally
// differ between environments, so they are excluded when comparing content.
const ENVELOPE_KEYS = ["environment", "model", "version", "input"];

const comparableContent = (prediction) => {
    if (prediction == null || typeof prediction !== "object" || Array.isArray(prediction)) return prediction;
    return Object.fromEntries(
        Object.entries(prediction).filter(([key]) => !ENVELOPE_KEYS.includes(key))
    );
};

// A span's identity for comparison: its type plus character boundaries. Two
// predictions match only if their span sets are identical (a partially-
// correct span is a different span). Natural language understanding spans
// are keyed by `slot` — the predicted role: `source` vs `destination`
// matters even when both resolve to `location` (older payloads carried the
// slot as `name`). Named entity recognition spans carry `entity`.
const entityKey = (entity) => `${entity.slot ?? entity.entity ?? entity.name}${entity.start}${entity.end}`;

// Same-spans check over two entity lists, plus whether their scores agree.
const compareEntitySets = (referenceEntities, entities) => {
    const referenceKeys = referenceEntities.map(entityKey).sort();
    const keys = entities.map(entityKey).sort();
    const spansMatch = referenceKeys.length === keys.length
        && referenceKeys.every((key, index) => key === keys[index]);
    if (!spansMatch) return "differ";
    const referenceScore = Object.fromEntries(referenceEntities.map((entity) => [entityKey(entity), entity.score]));
    const scoresMatch = entities.every((entity) => scoresClose(referenceScore[entityKey(entity)], entity.score));
    return scoresMatch ? "match" : "scores";
};

// How a comparison environment's prediction relates to development's:
// "differ" (labels/spans changed), "scores" (same labels/spans, different
// confidence), "match", or null when either side is missing or an error.
const comparePredictions = (reference, prediction) => {
    if (reference == null || prediction == null) return null;
    if (isErrorPrediction(reference) || isErrorPrediction(prediction)) return null;

    const referenceLabels = getLabels(reference);
    const labels = getLabels(prediction);
    if (referenceLabels && labels) {
        const labelsMatch = referenceLabels.length === labels.length
            && referenceLabels.every((item, index) => item.name === labels[index].name);
        if (!labelsMatch) return "differ";
        const scoresMatch = referenceLabels.every((item, index) => scoresClose(item.score, labels[index].score));
        return scoresMatch ? "match" : "scores";
    }

    // Natural language understanding: intents compare like ranked labels,
    // slots like entity spans; the stricter of the two verdicts wins.
    const referenceIntents = getIntents(reference);
    const intents = getIntents(prediction);
    if (referenceIntents && intents) {
        const intentsMatch = referenceIntents.length === intents.length
            && referenceIntents.every((item, index) => item.name === intents[index].name);
        if (!intentsMatch) return "differ";
        const spanStatus = compareEntitySets(getSlotEntities(reference), getSlotEntities(prediction));
        if (spanStatus === "differ") return "differ";
        const scoresMatch = referenceIntents.every((item, index) => scoresClose(item.score, intents[index].score));
        return scoresMatch && spanStatus === "match" ? "match" : "scores";
    }

    // Named entity recognition: compare the reconstructed entity spans, not the
    // whole JSON (envelope and per-token scores would spuriously "differ").
    const referenceEntities = getEntities(reference);
    const entities = getEntities(prediction);
    if (referenceEntities && entities) {
        return compareEntitySets(referenceEntities, entities);
    }

    return JSON.stringify(comparableContent(reference)) === JSON.stringify(comparableContent(prediction))
        ? "match"
        : "differ";
};

const COMPARE_STATUS = {
    match: { bg: "success", label: "MATCH" },
    scores: { bg: "warning", label: "SCORES DIFFER" },
    differ: { bg: "danger", label: "DIFFERS" }
};

// Line-level diff (LCS) between two pretty-printed JSON strings, tagging each
// line as unchanged, added (only in `after`), or removed (only in `before`).
const diffJsonLines = (before, after) => {
    const a = before.split("\n");
    const b = after.split("\n");
    const n = a.length;
    const m = b.length;
    const lengths = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lengths[i][j] = a[i] === b[j]
                ? lengths[i + 1][j + 1] + 1
                : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    }

    const rows = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            rows.push({ type: "same", text: b[j] });
            i++;
            j++;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            rows.push({ type: "remove", text: a[i] });
            i++;
        } else {
            rows.push({ type: "add", text: b[j] });
            j++;
        }
    }
    while (i < n) rows.push({ type: "remove", text: a[i++] });
    while (j < m) rows.push({ type: "add", text: b[j++] });
    return rows;
};

const TabTitle = ({ icon, children }) => (
    <span className="d-inline-flex align-items-center gap-2">
        {icon}
        {children}
    </span>
);

const getInstanceStatus = (instance) => {
    // Lazy deployments intentionally stay idle until the first request.
    if (
        instance?.config?.lazy &&
        (instance.status === "PENDING" || instance.status === "RECEIVED")
    ) {
        return {
            label: "STANDBY",
            bg: "secondary"
        };
    }

    switch (instance?.status) {
        case "PENDING":
        case "RECEIVED":
            return {
                label: "STARTING",
                bg: "info"
            };

        case "STARTED":
            return {
                label: "SERVING",
                bg: "success"
            };

        case "FAILURE":
            return {
                label: "FAILED",
                bg: "danger"
            };

        default:
            return {
                label: "STANDBY",
                bg: "secondary"
            };
    }
};

// Compact dashboard-style strip mirroring the History detail view.
const MetricStrip = ({
    environment,
    deployedVersion,
    deployedInstance,
    versionCount,
    latency
}) => {
    const status = deployedInstance
        ? getInstanceStatus(deployedInstance)
        : null;
    const items = [
        {
            label: "Environment",
            value: (
                <span className="d-flex align-items-center justify-content-between">
                    <span className="font-monospace text-lowercase">{environment}</span>
                    {status && (<Badge bg={status.bg}>{status.label}</Badge>)}
                </span>
            ),
            icon: <Hdd />
        },
        {
            label: "Version",
            value: deployedVersion && deployedInstance
                ? <span className="font-monospace">v{deployedVersion}</span>
                : <span className="text-muted">none</span>,
            icon: <Hash />
        },
        { label: "Available versions", value: versionCount, icon: <Collection /> },
        {
            label: "Last latency",
            value: latency != null ? <span className="font-monospace">{latency} ms</span> : "-",
            icon: <Stopwatch />
        }
    ];

    return (
        <Row className="g-3 mt-1">
            {items.map((item, index) => (
                <Col key={index} xs={6} lg={3}>
                    <Card className="h-100">
                        <Card.Body className="p-3 d-flex align-items-center">
                            <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                            <div className="flex-grow-1">
                                <div className="text-muted small fw-bold" style={{ fontSize: "0.65rem" }}>{item.label}</div>
                                <div className="text-body-emphasis small fw-medium">{item.value ?? "-"}</div>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            ))}
        </Row>
    );
};

const StatusDot = ({ color }) => (
    <span
        className="d-inline-block rounded-circle"
        style={{ width: "7px", height: "7px", backgroundColor: color }}
    />
);

// One environment's column in the side-by-side comparison. The development
// column passes `isReference`; the others pass development's prediction as
// `reference` so the header can flag agreement and, in JSON view, show a diff.
// `view` is "result" (rendered prediction) or "json" (raw / diff).
const CompareColumn = ({ name, version, deployed, loading, entry, query, reference, isReference, view, colorOf }) => {
    const prediction = entry?.prediction;
    const status = isReference ? null : comparePredictions(reference, prediction);
    const badge = status ? COMPARE_STATUS[status] : null;
    const canDiff = !isReference && reference != null;

    let body;
    if (!deployed) {
        body = <EmptyState icon={<Hdd />} minHeight="100%">Nothing deployed in this environment.</EmptyState>;
    } else if (loading && prediction == null) {
        body = (
            <div className="d-flex align-items-center justify-content-center flex-grow-1 py-4">
                <Spinner animation="border" size="sm" variant="secondary" />
            </div>
        );
    } else if (prediction == null) {
        body = <EmptyState icon={<SortDown />} minHeight="100%">Run a query to see the result.</EmptyState>;
    } else if (view === "json") {
        // body = canDiff
        //     ? <JsonDiffView data={prediction} reference={reference} />
        //     : <JsonView data={prediction} />;
        body = <JsonView data={prediction} />;
    } else {
        body = <PredictionView prediction={prediction} query={query} reference={isReference ? undefined : reference} colorOf={colorOf} />;
    }

    return (
        // Fill the parent column via flex (not h-100) so a bounded height is
        // available for the body to scroll against; percentage height doesn't
        // resolve reliably through the wrapping Bootstrap .row above.
        <Card className="w-100 flex-grow-1" style={{ minHeight: 0 }}>
            <Card.Header className="bg-body-tertiary py-2 px-3 d-flex align-items-center gap-2 flex-shrink-0">
                <span className="font-monospace small fw-bold text-lowercase">{name}</span>
                {deployed && version != null && (
                    <Badge bg="secondary-subtle" text="body-emphasis" className="border font-monospace fw-normal">
                        v{version}
                    </Badge>
                )}
                <span className="ms-auto d-inline-flex align-items-center gap-2">
                    {entry?.latency != null && (
                        <span className="text-muted font-monospace" style={{ fontSize: "0.7rem" }}>
                            {entry.latency} ms
                        </span>
                    )}
                    {badge && <Badge bg={badge.bg}>{badge.label}</Badge>}
                </span>
            </Card.Header>
            <Card.Body className="p-3 d-flex flex-column overflow-auto no-scrollbar" style={{ minHeight: 0 }}>
                {body}
            </Card.Body>
        </Card>
    );
};

// Line-by-line diff of a comparison environment's raw response against
// development's, so envelope and score differences are visible at a glance.
// const JsonDiffView = ({ data, reference }) => {
//     const rows = useMemo(
//         () => diffJsonLines(JSON.stringify(reference, null, 2), JSON.stringify(data, null, 2)),
//         [data, reference]
//     );

//     return (
//         <pre className="p-3 mb-0 bg-body-tertiary border-0 rounded small overflow-auto h-100">
//             {rows.map((row, index) => (
//                 <div
//                     key={index}
//                     className={
//                         row.type === "add"
//                             ? "bg-success-subtle text-success-emphasis"
//                             : row.type === "remove"
//                                 ? "bg-danger-subtle text-danger-emphasis"
//                                 : ""
//                     }
//                     style={{ whiteSpace: "pre-wrap" }}
//                 >
//                     <span className="me-2 opacity-50">
//                         {row.type === "add" ? "+" : row.type === "remove" ? "-" : " "}
//                     </span>
//                     {row.text}
//                 </div>
//             ))}
//         </pre>
//     );
// };

const Test = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const socket = useSocket();
    // Annotated model kinds keep a separate entity registry whose colours
    // the prediction views reuse alongside the intent palette.
    const annotated = model?.kind === "named_entity_recognition"
        || model?.kind === "natural_language_understanding";

    const [ready, setReady] = useState(false);

    const [trainings, setTrainings] = useState([]);
    const [selectedTrainingId, setSelectedTrainingId] = useState("");
    const [deployedTrainingId, setDeployedTrainingId] = useState(null);
    const [deployedAt, setDeployedAt] = useState(null);
    const [deployedInstance, setDeployedInstance] = useState(null);
    const [deploying, setDeploying] = useState(false);
    const [stopping, setStopping] = useState(false);

    const [query, setQuery] = useState("");
    const [top, setTop] = useState(1);
    const [labelCount, setLabelCount] = useState(0);
    const [labels, setLabels] = useState([]);
    const [result, setResult] = useState(null);
    const [latency, setLatency] = useState(null);
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sendError, setSendError] = useState(false);

    // Batch mode: which input surface is active, and the results of the
    // last CSV run ([{ input, meta, prediction }], index-aligned to the
    // uploaded rows; prediction is null while its chunk is in flight).
    const [mode, setMode] = useState("single");
    const [batchResults, setBatchResults] = useState(null);
    const [batchRunning, setBatchRunning] = useState(false);
    const [batchProgress, setBatchProgress] = useState(null);

    // Environment comparison: the testing/production instances (keyed by
    // environment name), whether the fan-out is enabled, which environments
    // it targets, how the columns render, and the outcomes.
    const [otherInstances, setOtherInstances] = useState({});
    const [compareEnabled, setCompareEnabled] = useState(false);
    const [compareTargets, setCompareTargets] = useState([]);
    const [compareView, setCompareView] = useState("result");
    const [compareResults, setCompareResults] = useState(null);
    const [compareLoading, setCompareLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("result");

    // Draggable split between the request and response cards. The gutter (and
    // the split itself) only applies from the lg breakpoint up, where the two
    // cards sit side by side; below it they stack full width.
    const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT);
    const [isWide, setIsWide] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(min-width: 992px)").matches
    );
    const splitRef = useRef(null);
    const draggingRef = useRef(false);

    useEffect(() => {
        const query = window.matchMedia("(min-width: 992px)");
        const handleChange = (event) => setIsWide(event.matches);
        query.addEventListener("change", handleChange);
        return () => query.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        const handleMove = (event) => {
            if (!draggingRef.current || !splitRef.current) return;
            const rect = splitRef.current.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const pct = ((clientX - rect.left) / rect.width) * 100;
            setSplitPct(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)));
        };
        const stopDrag = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", stopDrag);
        window.addEventListener("touchmove", handleMove, { passive: false });
        window.addEventListener("touchend", stopDrag);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", stopDrag);
            window.removeEventListener("touchmove", handleMove);
            window.removeEventListener("touchend", stopDrag);
        };
    }, []);

    const startDrag = (event) => {
        draggingRef.current = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        event.preventDefault();
    };

    const versionOf = useMemo(() => {
        const map = {};
        trainings.forEach((training) => { map[String(training.id)] = training.version; });
        return map;
    }, [trainings]);

    // Map an entity/slot name to the colour assigned to it in Build, so a
    // prediction's highlighted spans and IOB token chips read in the same colour
    // language as the annotation workspace. Names with no stored label (e.g. an
    // entity the model predicts that was never defined) fall back to the
    // deterministic name-based palette.
    const colorOf = useMemo(() => {
        const byName = new Map(labels.map((label) => [label.name, label.color]));
        return (name) => byName.get(name) || entityColor(name);
    }, [labels]);

    const deployedVersion = deployedTrainingId != null ? versionOf[String(deployedTrainingId)] : null;
    const isDeployed = deployedTrainingId != null;
    const busy = deploying || stopping;
    // Whether the version chosen in the dropdown is the one currently serving.
    const selectedIsDeployed = isDeployed && String(deployedTrainingId) === String(selectedTrainingId);
    // Comparison only makes sense once something is published beyond development.
    const availableCompareEnvironments = COMPARE_ENVIRONMENTS.filter((name) => otherInstances[name]);
    const compareAvailable = availableCompareEnvironments.length > 0;
    // Selected targets, intersected with what is actually deployed right now.
    const activeCompareTargets = compareTargets.filter((name) => otherInstances[name]);

    // Default the target selection to every deployed environment as they load.
    useEffect(() => {
        setCompareTargets(COMPARE_ENVIRONMENTS.filter((name) => otherInstances[name]));
    }, [otherInstances]);

    // The running instance is stale if its version was retrained after it was deployed.
    const deployedStale = useMemo(() => {
        if (!isDeployed || deployedAt == null) return false;
        const training = trainings.find((item) => String(item.id) === String(deployedTrainingId));
        const trainedAt = parseApiDate(training?.date_done);
        const receivedAt = parseApiDate(deployedAt);
        return trainedAt != null && receivedAt != null && trainedAt.getTime() > receivedAt.getTime();
    }, [isDeployed, deployedAt, deployedTrainingId, trainings]);

    // Load the model's trained versions and whatever is currently in development.
    useEffect(() => {
        if (!user || !modelId || !model) return;
        const headers = { Authorization: `Bearer ${user.token}` };

        const load = async () => {
            try {
                setReady(false);
                const [trainingsResponse, instancesResponse, intentsResponse, entitiesResponse] = await Promise.all([
                    axios.get(`/api/models/${modelId}/trainings`, { params: { per_page: 100 }, headers }),
                    axios.get(`/api/models/${modelId}/instances`, { headers }),
                    // Pull the intents (and, on annotated kinds, the entities)
                    // with their assigned colours so a prediction paints each
                    // name in the colour it was given in Build.
                    axios.get(`/api/models/${modelId}/intents`, { params: { per_page: 500 }, headers }),
                    annotated
                        ? axios.get(`/api/models/${modelId}/entities`, { params: { per_page: 500 }, headers })
                        : Promise.resolve({ data: { entities: [], total: 0 } })
                ]);

                const successful = (trainingsResponse.data.trainings || [])
                    .filter((training) => training.status === "SUCCESS")
                    .sort((a, b) => b.version - a.version);
                setTrainings(successful);

                setLabelCount((intentsResponse.data.total || 0) + (entitiesResponse.data.total || 0));
                setLabels([
                    ...(intentsResponse.data.intents || []),
                    ...(entitiesResponse.data.entities || [])
                ]);

                const instances = instancesResponse.data.instances || [];
                setOtherInstances(Object.fromEntries(
                    COMPARE_ENVIRONMENTS
                        .map((name) => [name, instances.find((instance) => instance.environment === name)])
                        .filter(([, instance]) => instance)
                ));

                const deployed = instances
                    .find((instance) => instance.environment === ENVIRONMENT);
                if (deployed) {
                    setDeployedInstance(deployed);
                    setDeployedTrainingId(deployed.training_id);
                    setDeployedAt(deployed.date_receive);
                    setSelectedTrainingId(String(deployed.training_id));
                }
            } catch (error) {
                setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
            } finally {
                setReady(true);
            }
        };
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, model?.kind]);

    // Stay in the task's room for as long as this deployment exists: the
    // backend reuses the task id when the serving task is lazily restarted,
    // so an idle (SUCCESS) instance can come back to life under the same id.
    const deployedTaskId = deployedInstance?.task_id;
    useEffect(() => {
        if (!user || !socket || !deployedTaskId) return;

        const handleStatus = (data) => {
            if (data.task_id !== deployedTaskId) return;
            setDeployedInstance(prev =>
                prev && prev.task_id === deployedTaskId
                    ? { ...prev, ...data, task_id: deployedTaskId }
                    : prev
            );
        };

        // Rooms don't survive a reconnect, so re-join on every "connect".
        const join = () => socket.emit("join", user.token, deployedTaskId);

        socket.on("status", handleStatus);
        socket.on("connect", join);
        if (socket.connected) join();

        return () => {
            socket.off("status", handleStatus);
            socket.off("connect", join);
            if (socket.connected) socket.emit("leave", user.token, deployedTaskId);
        };
    }, [user, socket, deployedTaskId]);

    const handleVersionChange = (event) => {
        setSelectedTrainingId(event.target.value);
        setResult(null);
        setLatency(null);
        setCompareResults(null);
        setBatchResults(null);
        setBatchProgress(null);

        if (labelCount > 0) {
            setTop(1);
        }
        setAlert(null);
    };

    // Deploy (or redeploy) the version currently selected in the dropdown.
    const handleDeploy = async () => {
        if (!selectedTrainingId || busy) return;
        setResult(null);
        setLatency(null);
        setCompareResults(null);
        setSendError(false);
        setDeploying(true);
        setAlert(null);
        try {
            // Development deployments always use the server defaults.
            // The backend injects the environment's default configuration
            // (lazy loading + response caching) and rejects configuration
            // changes for development.
            const response = await axios.post(
                `/api/models/${modelId}/instances`,
                { [ENVIRONMENT]: true },
                {
                    params: { training_id: selectedTrainingId },
                    headers: { Authorization: `Bearer ${user.token}` }
                }
            );
            const deployed = (response.data.instances || []).find((instance) => instance.environment === ENVIRONMENT);
            setDeployedInstance(deployed);
            setDeployedTrainingId(deployed ? deployed.training_id : selectedTrainingId);
            setDeployedAt(deployed ? deployed.date_receive : null);
            setResult(null);
            setLatency(null);
            setSendError(false);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setDeploying(false);
        }
    };

    // Stop and tear down whatever is deployed in the environment.
    const handleStop = async () => {
        if (!isDeployed || busy) return;
        setStopping(true);
        setAlert(null);
        try {
            await axios.post(
                `/api/models/${modelId}/instances`,
                { [ENVIRONMENT]: false },
                { params: { training_id: deployedTrainingId }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setDeployedInstance(null);
            setDeployedTrainingId(null);
            setDeployedAt(null);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setStopping(false);
        }
    };

    // Send the same query to every deployed comparison environment. Each one
    // is called on its own inference endpoint with its own API key, so a slow
    // or stopped environment only affects its own column.
    const runCompare = async () => {
        const targets = COMPARE_ENVIRONMENTS
            .filter((name) => compareTargets.includes(name) && otherInstances[name])
            .map((name) => ({ name, instance: otherInstances[name] }));
        if (targets.length === 0) return;

        setCompareLoading(true);
        setCompareResults(null);
        const entries = await Promise.all(targets.map(async ({ name, instance }) => {
            const startedAt = performance.now();
            try {
                const response = await axios.post(
                    instance.endpoint,
                    { inputs: [query] },
                    { params: { top }, headers: { Authorization: `Bearer ${instance.api_key}` } }
                );
                const prediction = response.data?.outputs?.[0]
                    ?? { error: "No output was returned.", type: "Missing" };
                return [name, { prediction, latency: Math.round(performance.now() - startedAt) }];
            } catch (error) {
                const data = error.response?.data;
                const prediction = data && (data.error || data.type)
                    ? data
                    : {
                        error: error.response?.status === 404
                            ? "The deployed version isn't serving. Redeploy it from the Publish tab."
                            : data?.error || error.message
                    };
                return [name, { prediction, latency: Math.round(performance.now() - startedAt) }];
            }
        }));
        setCompareResults(Object.fromEntries(entries));
        setCompareLoading(false);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!query.trim() || loading || !isDeployed) return;

        setResult(null);
        setLoading(true);
        setAlert(null);
        setSendError(false);
        if (compareEnabled) {
            runCompare();
        }
        // Land on the tab that will hold this run's outcome.
        setActiveTab((previous) => (
            compareEnabled ? "compare" : previous === "compare" ? "result" : previous
        ));
        const startedAt = performance.now();
        try {
            const response = await axios.post(
                `/api/infer/${modelId}`,
                // The endpoint is batch-only; a single query is a one-element
                // batch whose sole output is unwrapped here. That output may
                // itself be an { error, type } envelope, which PredictionView
                // renders like any other failure.
                { inputs: [query] },
                // The inference plane authenticates with the deployment's own
                // API key, not the user session token.
                { params: { top }, headers: { Authorization: `Bearer ${deployedInstance?.api_key || ""}` } }
            );
            const prediction = response.data?.outputs?.[0]
                ?? { error: "No output was returned.", type: "Missing" };
            setResult({ query, prediction, version: deployedVersion });
            setLatency(Math.round(performance.now() - startedAt));
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            setSendError(true);
            if (status === 404) {
                setAlert({
                    variant: "warning",
                    message: "The selected version isn't serving yet. Click reload to redeploy, then try again."
                });
            } else if (data && (data.error || data.type)) {
                setResult({ query, prediction: data, version: deployedVersion });
                setLatency(Math.round(performance.now() - startedAt));
            } else {
                setAlert({ variant: "danger", message: data?.error || error.message });
            }
        } finally {
            setLoading(false);
        }
    };

    // Run every parsed CSV row through the deployed model. Rows go out in
    // BATCH_CHUNK_SIZE chunks of one `{ inputs }` request each; outputs
    // stream into `batchResults` index-aligned to the rows, and every row
    // ends with either a prediction or an { error, type } envelope.
    const handleRunBatch = async (rows) => {
        if (!isDeployed || batchRunning || rows.length === 0) return;
        setBatchRunning(true);
        setAlert(null);
        setActiveTab("batch");
        setBatchProgress({ done: 0, total: rows.length });
        const results = rows.map((row) => ({ ...row, prediction: null }));
        setBatchResults([...results]);

        const headers = { Authorization: `Bearer ${deployedInstance?.api_key || ""}` };
        const startedAt = performance.now();
        for (let start = 0; start < rows.length; start += BATCH_CHUNK_SIZE) {
            const chunk = rows.slice(start, start + BATCH_CHUNK_SIZE);
            try {
                const response = await axios.post(
                    `/api/infer/${modelId}`,
                    { inputs: chunk.map((row) => row.input) },
                    { params: { top }, headers }
                );
                const outputs = response.data?.outputs || [];
                chunk.forEach((row, index) => {
                    results[start + index].prediction = outputs[index]
                        ?? { error: "No output was returned for this input.", type: "Missing" };
                });
            } catch (error) {
                if (error.response?.status === 404) {
                    // The deployment vanished mid-run: flag the remaining
                    // rows instead of dropping them and stop submitting.
                    setAlert({
                        variant: "warning",
                        message: "The selected version isn't serving yet. Click reload to redeploy, then run the batch again."
                    });
                    for (let index = start; index < rows.length; index++) {
                        results[index].prediction = {
                            error: "Not run — the deployed version isn't serving.",
                            type: "NotServing"
                        };
                    }
                    setBatchProgress({ done: rows.length, total: rows.length });
                    setBatchResults([...results]);
                    break;
                }
                const data = error.response?.data;
                const failure = {
                    error: data?.error || error.message,
                    type: data?.type || (error.response?.status === 504 ? "Timeout" : "RequestFailed")
                };
                chunk.forEach((row, index) => {
                    results[start + index].prediction = { ...failure };
                });
            }
            setBatchProgress({ done: Math.min(start + BATCH_CHUNK_SIZE, rows.length), total: rows.length });
            setBatchResults([...results]);
        }
        setLatency(Math.round(performance.now() - startedAt));
        setBatchRunning(false);
    };

    return (
        <div className="pb-5">
            <Row className="mt-4">
                <Col>
                    {alert && (
                        <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>
                            {alert.message}
                        </Alert>
                    )}
                </Col>
            </Row>

            <MetricStrip
                environment={ENVIRONMENT}
                deployedVersion={deployedVersion}
                deployedInstance={deployedInstance}
                versionCount={trainings.length}
                latency={latency}
            />

            <div
                ref={splitRef}
                className={`d-flex mt-4 ${isWide ? "flex-row align-items-stretch" : "flex-column gap-3"}`}
            >
                <div
                    className="d-flex"
                    style={isWide
                        ? { flex: `0 0 calc(${splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                        : { width: "100%" }}
                >
                    <Card className="border-light shadow-sm h-100 w-100 overflow-hidden">
                        <CardHeading
                            icon={<Send />}
                            title="Request"
                        />
                        <Card.Body className="p-3 d-flex flex-column">
                            {trainings.length && ready === 0 ? (
                                <Alert variant="warning" className="d-flex align-items-start gap-2 small mb-0">
                                    <InfoCircle className="mt-1 flex-shrink-0" />
                                    <span>No successfully trained versions yet. Train one from the History tab, then come back to test it.</span>
                                </Alert>
                            ) : (
                                <>
                                    <Form.Group className="mb-3">
                                        <Form.Label className="mb-1"><SectionLabel>Version</SectionLabel></Form.Label>
                                        <div className="d-flex align-items-center gap-2">
                                            <Form.Select
                                                value={selectedTrainingId}
                                                onChange={handleVersionChange}
                                                disabled={busy}
                                                size="sm"
                                            >
                                                <option value="">Select a version…</option>
                                                {trainings.map((training) => (
                                                    <option key={training.id} value={training.id}>
                                                        v{training.version}
                                                    </option>
                                                ))}
                                            </Form.Select>
                                            <Button
                                                variant="light"
                                                size="sm"
                                                className={`border ${selectedIsDeployed ? "text-danger" : ""} d-inline-flex align-items-center flex-shrink-0`}
                                                title={selectedIsDeployed ? "Stop deployed model" : "Load selected version"}
                                                onClick={selectedIsDeployed ? handleStop : handleDeploy}
                                                disabled={busy || !selectedTrainingId}
                                            >
                                                {selectedIsDeployed ? <Stop /> : <Play />}
                                            </Button>
                                            <Button
                                                variant="light"
                                                size="sm"
                                                className="border d-inline-flex align-items-center flex-shrink-0"
                                                title="Redeploy the latest trained artifact for this version"
                                                onClick={handleDeploy}
                                                disabled={busy || !selectedIsDeployed}
                                            >
                                                <ArrowClockwise />
                                            </Button>
                                        </div>
                                        <div className="text-muted d-flex align-items-center gap-1 mt-1" style={{ fontSize: "0.7rem", minHeight: "16px" }}>
                                            {busy ? (
                                                <><Spinner animation="border" size="sm" />&nbsp;{stopping ? "Stopping" : "Deploying"} in {ENVIRONMENT}…</>
                                            ) : (
                                                <span>Deploy a version, then reload to push a freshly retrained model.</span>
                                            )}
                                        </div>
                                        {deployedStale && !busy && (
                                            <Alert variant="warning" className="d-flex align-items-start gap-2 small mb-0 mt-2 py-2">
                                                <ExclamationTriangle className="mt-1 flex-shrink-0" />
                                                <span>v{deployedVersion} was retrained after it was deployed. Click reload to serve the latest model.</span>
                                            </Alert>
                                        )}
                                    </Form.Group>

                                    <ButtonGroup size="sm" className="mb-3 align-self-start">
                                        <Button
                                            variant="light"
                                            className="border d-inline-flex align-items-center gap-1"
                                            active={mode === "single"}
                                            onClick={() => {
                                                setMode("single");
                                                setActiveTab((previous) => (previous === "batch" ? "result" : previous));
                                            }}
                                        >
                                            <CardText />&nbsp;Single
                                        </Button>
                                        <Button
                                            variant="light"
                                            className="border d-inline-flex align-items-center gap-1"
                                            active={mode === "batch"}
                                            onClick={() => {
                                                setMode("batch");
                                                setActiveTab("batch");
                                            }}
                                        >
                                            <Files />&nbsp;Batch
                                        </Button>
                                    </ButtonGroup>

                                    {/* Both surfaces stay mounted (hidden via d-none) so the
                                        parsed CSV survives toggling between the modes. */}
                                    <Form onSubmit={handleSubmit} className={`${mode === "single" ? "d-flex" : "d-none"} flex-column flex-grow-1`}>
                                        <Form.Label className="mb-1"><SectionLabel>Input</SectionLabel></Form.Label>
                                        <Form.Control
                                            as="textarea"
                                            rows={6}
                                            value={query}
                                            placeholder={isDeployed ? "Type a sentence to send to the model…" : "Deploy a version first to start testing."}
                                            onChange={(event) => { setQuery(event.target.value); setSendError(false); }}
                                            onKeyDown={(event) => {
                                                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                    handleSubmit(event);
                                                }
                                            }}
                                            className="mb-3 flex-grow-1"
                                            disabled={loading || busy || !isDeployed}
                                        />
                                        {labelCount > 1 && (
                                            <div className="mb-3">
                                                <div className="d-flex align-items-center justify-content-between mb-1">
                                                    <SectionLabel>Top labels</SectionLabel>
                                                    <span className="font-monospace small text-body-emphasis">{top} / {labelCount}</span>
                                                </div>
                                                <Form.Range
                                                    min={1}
                                                    max={labelCount}
                                                    value={top}
                                                    onChange={(event) => setTop(Number(event.target.value))}
                                                    disabled={loading || busy || !isDeployed}
                                                />
                                            </div>
                                        )}
                                            <Form.Group  className="mb-3">
                                                <Form.Check
                                                    type="switch"
                                                    id="compare-environments"
                                                    className="small"
                                                    label="Compare environments"
                                                    checked={compareEnabled}
                                                    onChange={(event) => {
                                                        setCompareEnabled(event.target.checked);
                                                        if (!event.target.checked) setCompareResults(null);
                                                    }}
                                                    disabled={loading || compareLoading || busy || !isDeployed || !compareAvailable}
                                                />
                                                
                                                {compareAvailable ? (
                                                    <Form.Text className="text-muted d-block" style={{ fontSize: "0.7rem" }}>
                                                        Also send the query to the selected environments and compare
                                                        their predictions with development.
                                                    </Form.Text>
                                                ) : (
                                                    <Form.Text className="text-muted d-block" style={{ fontSize: "0.7rem" }}>
                                                        No version are deployed in any environment for this model.
                                                    </Form.Text>
                                                )}
                                                {compareEnabled && (
                                                    <div className="d-flex flex-wrap gap-3 mt-2">
                                                        {availableCompareEnvironments.map((name) => (
                                                            <Form.Check
                                                                key={name}
                                                                type="checkbox"
                                                                id={`compare-target-${name}`}
                                                                className="small text-capitalize"
                                                                label={name}
                                                                checked={compareTargets.includes(name)}
                                                                onChange={(event) => {
                                                                    setCompareTargets((previous) => (
                                                                        event.target.checked
                                                                            ? [...previous, name]
                                                                            : previous.filter((item) => item !== name)
                                                                    ));
                                                                    setCompareResults(null);
                                                                }}
                                                                disabled={loading || compareLoading || busy || !isDeployed}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </Form.Group>
                                        <div className="d-flex align-items-center justify-content-between">
                                            <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: "0.7rem" }}>
                                                <kbd className="bg-body-secondary text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>⌘/Ctrl</kbd>
                                                +
                                                <kbd className="bg-body-secondary text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>Enter</kbd>
                                                to run
                                            </span>
                                            <Button type="submit" variant="light" size="sm" disabled={loading || busy || !isDeployed || !query.trim()} className="border d-inline-flex align-items-center gap-1 px-3">
                                                {loading ? (
                                                    <><Spinner animation="border" size="sm" />&nbsp;Sending</>
                                                ) : !isDeployed ? (
                                                    <><SendSlash />&nbsp;Send</>
                                                ) : sendError ? (
                                                    <><SendExclamation />&nbsp;Send</>
                                                ) : !query.trim() ? (
                                                    <><SendDash />&nbsp;Send</>
                                                ) : (
                                                    <><SendCheck />&nbsp;Send</>
                                                )}
                                            </Button>
                                        </div>
                                    </Form>

                                    <div className={mode === "batch" ? "d-flex flex-column flex-grow-1" : "d-none"}>
                                        <BatchPanel
                                            isDeployed={isDeployed}
                                            busy={busy || loading}
                                            running={batchRunning}
                                            progress={batchProgress}
                                            top={top}
                                            labelCount={labelCount}
                                            onTopChange={setTop}
                                            onRun={handleRunBatch}
                                        />
                                    </div>
                                </>
                            )}
                        </Card.Body>
                    </Card>
                </div>

                {isWide && (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={startDrag}
                        onTouchStart={startDrag}
                        onDoubleClick={() => setSplitPct(DEFAULT_SPLIT)}
                        title="Drag to resize · double-click to reset"
                        className="d-flex align-items-center justify-content-center flex-shrink-0 text-body-secondary"
                        style={{ width: `${SPLIT_GUTTER}px`, cursor: "col-resize", touchAction: "none", alignSelf: "stretch" }}
                    >
                        <GripVertical size={16} />
                    </div>
                )}

                <div
                    className="d-flex"
                    style={isWide
                        ? { flex: `1 1 calc(${100 - splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                        : { width: "100%" }}
                >
                    <Card className="border-light shadow-sm h-100 w-100 overflow-hidden">
                        <CardHeading
                            icon={<Reply />}
                            title="Response"
                        />
                        <Card.Body className="p-3 d-flex flex-column">
                            <Tab.Container activeKey={activeTab} onSelect={(key) => setActiveTab(key || "result")}>
                                <Nav size="sm" variant="pills" className="custom-tabs gap-2 flex-shrink-0">
                                    <Nav.Item>
                                        <Nav.Link eventKey="result"><TabTitle icon={<SortDown />}>Result</TabTitle></Nav.Link>
                                    </Nav.Item>
                                    <Nav.Item>
                                        <Nav.Link eventKey="json"><TabTitle icon={<Braces />}>JSON</TabTitle></Nav.Link>
                                    </Nav.Item>
                                    <Nav.Item>
                                        <Nav.Link eventKey="batch"><TabTitle icon={<Files />}>Batch</TabTitle></Nav.Link>
                                    </Nav.Item>

                                        <Nav.Item>
                                            <Nav.Link disabled={!compareAvailable} eventKey="compare"><TabTitle icon={<ColumnsGap />}>Compare</TabTitle></Nav.Link>
                                        </Nav.Item>
                                </Nav>
                                <Tab.Content
                                    className="flex-grow-1 pt-3"
                                    style={{ height: "calc(100vh - 460px)", minHeight: "260px" }}
                                >
                                    <Tab.Pane eventKey="result" className="h-100 overflow-auto no-scrollbar">
                                        <PredictionView prediction={result?.prediction} query={result?.query} colorOf={colorOf} />
                                    </Tab.Pane>
                                    <Tab.Pane eventKey="json" className="h-100">
                                        {result ? (
                                            <JsonView data={result.prediction} />
                                        ) : (
                                            <EmptyState icon={<Braces />} minHeight="100%">The raw response will appear here.</EmptyState>
                                        )}
                                    </Tab.Pane>
                                    <Tab.Pane eventKey="batch" className="h-100">
                                        <BatchResults
                                            results={batchResults}
                                            running={batchRunning}
                                            progress={batchProgress}
                                            colorOf={colorOf}
                                        />
                                    </Tab.Pane>
                                    {compareAvailable && (
                                        <Tab.Pane eventKey="compare" className="h-100 d-flex flex-column">
                                            {!compareEnabled ? (
                                                <EmptyState icon={<ColumnsGap />} minHeight="100%">
                                                    Turn on "Compare environments" in the request panel, then run a query.
                                                </EmptyState>
                                            ) : activeCompareTargets.length === 0 ? (
                                                <EmptyState icon={<ColumnsGap />} minHeight="100%">
                                                    Select at least one environment to compare in the request panel.
                                                </EmptyState>
                                            ) : !result && !loading && !compareLoading ? (
                                                <EmptyState icon={<ColumnsGap />} minHeight="100%">
                                                    Run a query to compare environments.
                                                </EmptyState>
                                            ) : (
                                                <>
                                                    <div className="d-flex align-items-center justify-content-between gap-2 mb-3 flex-shrink-0">
                                                        <span className="text-muted small">
                                                            {compareView === "json"
                                                                ? "Lines added or removed versus development are highlighted."
                                                                : "Compared on the predicted output versus development."}
                                                        </span>
                                                        <ButtonGroup size="sm">
                                                            <Button
                                                                variant="light"
                                                                className="border"
                                                                onClick={() => setCompareView("result")}
                                                                active={compareView === "result"}
                                                            >
                                                                <SortDown />
                                                            </Button>
                                                            <Button
                                                                variant="light"
                                                                className="border"
                                                                onClick={() => setCompareView("json")}
                                                                active={compareView === "json"}
                                                            >
                                                                <Braces />
                                                            </Button>
                                                        </ButtonGroup>
                                                    </div>
                                                    {/* overflow-auto only engages below md, where the columns
                                                        stack taller than the pane; from md up the row fits and
                                                        each card body scrolls on its own. */}
                                                    <div className="flex-grow-1 d-flex flex-column overflow-auto" style={{ minHeight: 0 }}>
                                                        {/* flex-md-nowrap keeps the row single-line from md up:
                                                            only a single-line flex container caps its line at the
                                                            container height, letting the columns (and the cards
                                                            inside) shrink below their content so the card bodies
                                                            scroll. A wrapping row sizes its line to the tallest
                                                            column's content and overflows instead. */}
                                                        <Row className="g-3 flex-md-nowrap flex-grow-1" style={{ minHeight: 0 }}>
                                                            <Col md key={ENVIRONMENT} className="d-flex flex-column" style={{ minHeight: 0 }}>
                                                                <CompareColumn
                                                                    name={ENVIRONMENT}
                                                                    version={result?.version ?? deployedVersion}
                                                                    deployed={isDeployed}
                                                                    loading={loading}
                                                                    entry={result ? { prediction: result.prediction, latency } : null}
                                                                    query={result?.query}
                                                                    isReference
                                                                    view={compareView}
                                                                    colorOf={colorOf}
                                                                />
                                                            </Col>
                                                            {activeCompareTargets.map((name) => (
                                                                <Col md key={name} className="d-flex flex-column" style={{ minHeight: 0 }}>
                                                                    <CompareColumn
                                                                        name={name}
                                                                        version={versionOf[String(otherInstances[name].training_id)]}
                                                                        deployed
                                                                        loading={compareLoading}
                                                                        entry={compareResults?.[name] || null}
                                                                        query={result?.query}
                                                                        reference={result?.prediction}
                                                                        view={compareView}
                                                                        colorOf={colorOf}
                                                                    />
                                                                </Col>
                                                            ))}
                                                        </Row>
                                                    </div>
                                                </>
                                            )}
                                        </Tab.Pane>
                                    )}
                                </Tab.Content>
                            </Tab.Container>
                        </Card.Body>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Test;
