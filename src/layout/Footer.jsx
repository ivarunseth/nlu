import { useMatch, useNavigate } from "react-router-dom";
import { useTrainings, trainingProgress } from "../contexts/TrainingContext";

// The page's foot: a bare full-width strip that closes the layout, carrying
// nothing — until a training runs. Then, on that model's pages only, it
// hosts one row per run the user has going, centred: model, version, where
// it is, and a bar filling left to right along the row's top edge. Other
// models' runs are not shown, and the home page never shows any: the strip
// reports on the model in view, not on the account. Metrics stay on the
// History page, which a row links to. Rows go when their runs finish (after
// lingering a few seconds with the outcome), and the strip returns to bare.
const STATUS_LABEL = {
    PENDING: "queued",
    RECEIVED: "starting",
    SUCCESS: "completed",
    FAILURE: "failed",
    ABORTED: "stopped",
    REVOKED: "cancelled"
};

const describe = (run) => {
    if (run.status === "STARTED") {
        const { epoch, epochs } = run.progress || {};
        if (epoch && epochs) return `epoch ${epoch} / ${epochs}`;
        return "training";
    }
    return STATUS_LABEL[run.status] || run.status.toLowerCase();
};

const Footer = () => {
    const navigate = useNavigate();
    // The footer sits outside the model route, so useParams is empty here.
    const modelId = useMatch("/models/:modelId/*")?.params.modelId;
    const trainings = useTrainings().filter((run) => String(run.modelId) === modelId);

    return (
        <footer className="app-footer" role={trainings.length ? "status" : undefined} aria-live="polite">
            {trainings.map((run) => {
                const fraction = trainingProgress(run);
                const done = ["SUCCESS", "FAILURE", "ABORTED", "REVOKED"].includes(run.status);
                const tone = run.status === "SUCCESS" ? "success" : run.status === "FAILURE" ? "danger" : done ? "muted" : "primary";
                return (
                    <button
                        key={run.taskId}
                        type="button"
                        className={`training-strip-row training-strip-${tone}`}
                        onClick={() => navigate(`/models/${run.modelId}/history/${run.trainingId}`)}
                        title="Open this run in History"
                    >
                        <span className="training-strip-dot" aria-hidden="true" />
                        <span className="training-strip-text">
                            <span className="fw-medium">{run.modelName}</span>
                            <span className="training-strip-sep">·</span>
                            <span className="font-monospace">v{Number(run.version).toFixed(1)}</span>
                            <span className="training-strip-sep">·</span>
                            <span>{describe(run)}</span>
                        </span>
                        <span className="training-strip-pct font-monospace">
                            {fraction === null ? "" : `${Math.round(fraction * 100)}%`}
                        </span>
                        <span
                            className={`training-strip-bar${fraction === null ? " training-strip-bar-indeterminate" : ""}`}
                            style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
                            aria-hidden="true"
                        />
                    </button>
                );
            })}
        </footer>
    );
};

export default Footer;
