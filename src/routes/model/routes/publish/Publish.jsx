import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";
import {
    ArrowClockwise,
    ArrowRepeat,
    Clipboard,
    ClipboardCheck,
    Clock,
    Eye,
    EyeSlash,
    Key,
    Link45deg,
    Terminal,
    Hdd,
    CloudArrowUp,
    ExclamationTriangle,
    GraphUp,
    Hash,
    InfoCircle,
    RocketTakeoff,
    ShieldCheck,
    XCircle,
    Stop,
    HddStack,
    CloudHaze2,
    CloudPlus,
    Option
} from "react-bootstrap-icons";
import { useParams, Link } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import { useSocket } from "../../../../contexts/SocketContext";
import { CardHeading } from "../../../../shared/components/SectionCard";
import axios from "axios";

// Deployment pipeline, ordered. Models are validated in testing before production.
const ENVIRONMENTS = [
    {
        name: "testing",
        label: "Testing",
        icon: <Hdd />,
        description: "Staging environment for validating a trained version before release."
    },
    {
        name: "production",
        label: "Production",
        icon: <Hdd />,
        description: "Live environment serving real traffic. Promote only validated versions."
    }
];

// Parse the "dd/mm/yyyy - HH:MM:SS" local-time strings the API returns into a Date.
const parseApiDate = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const [, day, month, year, hour, minute, second] = match;
    return new Date(+year, +month - 1, +day, +hour, +minute, +second);
};

const getTrainingAccuracy = (training) => {
    const result = training?.result;
    if (!result) return null;
    return result.accuracy ?? result.evaluation?.test?.accuracy ?? null;
};

// A published instance stays routable even when its serving task has gone
// idle; the next prediction request starts it again. Surface that as standby.
const getInstanceStatus = (instance) => {
    switch (instance?.status) {
        case "PENDING":
        case "RECEIVED": return { label: "STARTING", bg: "info" };
        case "STARTED": return { label: "SERVING", bg: "success" };
        case "FAILURE": return { label: "FAILED", bg: "danger" };
        default: return { label: "STANDBY", bg: "secondary" };
    }
};

const EnvironmentCard = ({
    environment,
    instance,
    training,
    stale,
    busy,
    busyLabel,
    onReload,
    onUndeploy,
    onPromote,
    live,
    onResetKey
}) => {
    const status = instance ? getInstanceStatus(instance) : null;
    const accuracy = getTrainingAccuracy(training);
    const [showKey, setShowKey] = useState(false);
    // Which item was just copied: 'key' | 'url' | 'curl'.
    const [copied, setCopied] = useState(null);

    const copy = async (what, text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(what);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // Clipboard unavailable (e.g. insecure context); reveal instead.
            if (what === "key") setShowKey(true);
        }
    };

    // The backend derives the endpoint from the environment's inference
    // host and port, so display and copy always match the real deployment.
    const inferUrl = instance?.endpoint || "";
    const curlSnippet = instance ? [
        `curl -X POST '${inferUrl}?top=1'`,
        `  -H 'Authorization: Bearer ${instance.api_key}'`,
        `  -H 'Content-Type: application/json'`,
        `  -d '{"query": "Hello there"}'`
    ].join(" \\\n") : "";

    return (
        <Card className="border-light h-100 overflow-hidden">
            <CardHeading
                icon={environment.icon}
                title={environment.label}
                right={instance && <Badge bg={status.bg}>{status.label}</Badge>}
            />
            <Card.Body className="p-3 d-flex flex-column">
                {instance ? (
                    <>
                        <div className="d-flex align-items-start gap-2 mb-3">
                            <span className="text-primary fs-4 fw-bold font-monospace"><Hash/></span>
                            <span className="fs-4 fw-bold font-monospace text-body-emphasis">
                                v{training ? training.version : instance.training_id}
                            </span>
                            {onPromote && (
                                <div className="ms-auto d-flex flex-column align-items-end">
                                    <Form.Check
                                        type="switch"
                                        id={`promote-switch-${environment.name}`}
                                        label="Live"
                                        checked={live}
                                        disabled={busy || live}
                                        onChange={() => onPromote()}
                                        title={live
                                            ? `v${training?.version} is live — undeploy it from the Production card`
                                            : `Promote v${training?.version} to production`}
                                    />
                                    {live ? (
                                        <span className="text-muted text-end" style={{ fontSize: "0.7rem" }}>
                                            Use the stop button to undeploy.
                                        </span>
                                    ) : (
                                        <span className="text-muted text-end" style={{ fontSize: "0.7rem" }}>
                                            Promote to production
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                            <Clock className="flex-shrink-0" />
                            <span>Deployed at {instance.date_receive || "-"}</span>
                        </div>
                        {instance.api_key && (
                            <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                                <Key className="flex-shrink-0" />
                                <span className="font-monospace text-truncate flex-grow-1" style={{ minWidth: 0 }}>
                                    {showKey ? instance.api_key : "•".repeat(24)}
                                </span>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0 text-muted"
                                    onClick={() => setShowKey(!showKey)}
                                    title={showKey ? "Hide API key" : "Show API key"}
                                >
                                    {showKey ? <EyeSlash /> : <Eye />}
                                </Button>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0 text-muted"
                                    onClick={() => copy("key", instance.api_key)}
                                    title="Copy API key"
                                >
                                    {copied === "key" ? <ClipboardCheck className="text-success" /> : <Clipboard />}
                                </Button>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0 text-muted"
                                    disabled={busy}
                                    onClick={onResetKey}
                                    title="Reset API key"
                                >
                                    <ArrowRepeat />
                                </Button>
                            </div>
                        )}
                        <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                            <Link45deg className="flex-shrink-0" />
                            <span className="fw-bold" style={{ fontSize: "0.7rem" }}>POST</span>
                            <span className="font-monospace text-truncate flex-grow-1" style={{ minWidth: 0 }} title={inferUrl}>
                                {inferUrl.replace(/^https?:\/\//, "")}
                            </span>
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-muted"
                                onClick={() => copy("url", inferUrl)}
                                title="Copy endpoint URL"
                            >
                                {copied === "url" ? <ClipboardCheck className="text-success" /> : <Clipboard />}
                            </Button>
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-muted"
                                onClick={() => copy("curl", curlSnippet)}
                                title="Copy request as curl (includes the API key)"
                            >
                                {copied === "curl" ? <ClipboardCheck className="text-success" /> : <Terminal />}
                            </Button>
                        </div>
                        {stale && (
                            <Alert variant="warning" className="d-flex align-items-start gap-2 small mb-0 mt-2 py-2">
                                <ExclamationTriangle className="mt-1 flex-shrink-0" />
                                <span>
                                    v{training?.version} was retrained after this deployment. Reload to serve the latest model.
                                </span>
                            </Alert>
                        )}
                        <div className="d-flex align-items-center gap-2 mt-auto pt-3">
                            {onUndeploy && (
                                <Button
                                    variant="light"
                                    size="sm"
                                    className="border text-danger d-inline-flex align-items-center gap-1"
                                    disabled={busy}
                                    onClick={onUndeploy}
                                    title={`Undeploy v${training?.version} from ${environment.name}`}
                                >
                                    <Stop />
                                </Button>
                            )}
                            <Button
                                variant="light"
                                size="sm"
                                className="border d-inline-flex align-items-center gap-1"
                                disabled={busy}
                                onClick={onReload}
                                title={`Redeploy v${training?.version} in ${environment.name}`}
                            >
                                <ArrowClockwise />
                            </Button>
                            <div className="ms-auto d-flex align-items-center gap-2">
                                {busy && (
                                    <span className="small text-muted d-inline-flex align-items-center gap-2">
                                        <Spinner animation="border" size="sm" />{busyLabel}
                                    </span>
                                )}
                                </div>
                        </div>
                    </>
                ) : (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted flex-grow-1 py-4">
                        <CloudHaze2 className="fs-3 mb-2 opacity-50" />
                        <p className="mb-1 small fw-bold">Nothing deployed</p>
                        <p className="mb-0 text-muted" style={{ fontSize: "0.7rem", maxWidth: "260px" }}>
                            {environment.description}
                        </p>
                        {busy && (
                            <span className="small text-muted d-inline-flex align-items-center gap-2 mt-3">
                                <Spinner animation="border" size="sm" />{busyLabel}
                            </span>
                        )}
                    </div>
                )}
            </Card.Body>
        </Card>
    );
};

const Publish = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const socket = useSocket();

    const [trainings, setTrainings] = useState([]);
    const [instances, setInstances] = useState([]);
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(true);
    // { type: 'deploy' | 'undeploy', environment, trainingId } while a request is in flight.
    const [pendingAction, setPendingAction] = useState(null);
    // { type: 'deploy' | 'undeploy', environment, training } awaiting confirmation.
    const [confirmAction, setConfirmAction] = useState(null);
    const [validatedInTesting, setValidatedInTesting] = useState(false);
    const rooms = useRef(new Set());

    const trainingById = useMemo(() => {
        const map = {};
        trainings.forEach((training) => { map[String(training.id)] = training; });
        return map;
    }, [trainings]);

    const instanceByEnvironment = useMemo(() => {
        const map = {};
        instances.forEach((instance) => { map[instance.environment] = instance; });
        return map;
    }, [instances]);

    const testingInstance = instanceByEnvironment.testing;
    const productionInstance = instanceByEnvironment.production;

    // A deployment is stale when its version was retrained after it was published.
    const isInstanceStale = (instance) => {
        if (!instance) return false;
        const training = trainingById[String(instance.training_id)];
        const trainedAt = parseApiDate(training?.date_done);
        const receivedAt = parseApiDate(instance.date_receive);
        return trainedAt != null && receivedAt != null && trainedAt.getTime() > receivedAt.getTime();
    };

    useEffect(() => {
        if (!user || !modelId) return;
        const headers = { Authorization: `Bearer ${user.token}` };

        const load = async () => {
            try {
                setLoading(true);
                const [trainingsResponse, instancesResponse] = await Promise.all([
                    axios.get(`/api/models/${modelId}/trainings`, { params: { per_page: 100 }, headers }),
                    axios.get(`/api/models/${modelId}/instances`, { headers })
                ]);
                const successful = (trainingsResponse.data.trainings || [])
                    .filter((training) => training.status === "SUCCESS")
                    .sort((a, b) => b.version - a.version);
                setTrainings(successful);
                setInstances(instancesResponse.data.instances || []);
            } catch (error) {
                setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [user, modelId]);

    // Live serving-status updates for deployed instances. Rooms are keyed by
    // task id and joined regardless of the current status: an idle (STANDBY)
    // instance is revived under the same task id by the next prediction
    // request, so its room must stay watched to catch it coming back to life.
    const instanceTaskIds = useMemo(
        () => instances.filter((instance) => instance.task_id).map((instance) => instance.task_id),
        [instances]
    );
    const instanceTaskKey = instanceTaskIds.join("|");

    useEffect(() => {
        if (!user || !socket || instanceTaskIds.length === 0) return;
        const activeRooms = rooms.current;

        const handleStatus = (data) => {
            if (!activeRooms.has(data.task_id)) return;
            setInstances((prev) => prev.map((instance) => (
                instance.task_id === data.task_id ? { ...instance, ...data, task_id: instance.task_id } : instance
            )));
        };

        const join = () => {
            instanceTaskIds.forEach((taskId) => {
                if (!activeRooms.has(taskId)) {
                    socket.emit("join", user.token, taskId);
                    activeRooms.add(taskId);
                }
            });
        };

        socket.on("status", handleStatus);
        socket.on("connect", join);
        if (socket.connected) join();

        return () => {
            socket.off("status", handleStatus);
            socket.off("connect", join);
            instanceTaskIds.forEach((taskId) => {
                if (socket.connected) socket.emit("leave", user.token, taskId);
                activeRooms.delete(taskId);
            });
        };
    }, [user, socket, instanceTaskKey]);

    const handleDeploy = async (environment, trainingId) => {
        setPendingAction({ type: "deploy", environment, trainingId });
        setAlert(null);
        try {
            const response = await axios.post(
                `/api/models/${modelId}/instances`,
                { [environment]: true },
                { params: { training_id: trainingId }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setInstances(response.data.instances || []);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setPendingAction(null);
        }
    };

    const handleUndeploy = async (environment) => {
        const instance = instanceByEnvironment[environment];
        if (!instance) return;
        setPendingAction({ type: "undeploy", environment, trainingId: instance.training_id });
        setAlert(null);
        try {
            const response = await axios.post(
                `/api/models/${modelId}/instances`,
                { [environment]: false },
                { params: { training_id: instance.training_id }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setInstances(response.data.instances || []);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setPendingAction(null);
        }
    };

    const handleResetKey = async (environment) => {
        const instance = instanceByEnvironment[environment];
        if (!instance) return;
        setPendingAction({ type: "reset-key", environment, trainingId: instance.training_id });
        setAlert(null);
        try {
            const response = await axios.put(
                `/api/models/${modelId}/instances/${instance.id}`,
                { api_key: null },
                { headers: { Authorization: `Bearer ${user.token}` } }
            );
            setInstances((prev) => prev.map((item) => (
                item.id === response.data.instance.id ? response.data.instance : item
            )));
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setPendingAction(null);
        }
    };

    const openConfirm = (type, environment, training) => {
        setValidatedInTesting(false);
        setConfirmAction({ type, environment, training });
    };

    const closeConfirm = () => setConfirmAction(null);

    const submitConfirm = async () => {
        const action = confirmAction;
        setConfirmAction(null);
        if (!action) return;
        if (action.type === "deploy" || action.type === "reload") await handleDeploy(action.environment, action.training.id);
        if (action.type === "undeploy") await handleUndeploy(action.environment);
        if (action.type === "reset-key") await handleResetKey(action.environment);
    };

    const environmentBusy = (environment) => pendingAction?.environment === environment;

    const busyLabel = pendingAction?.type === "undeploy"
        ? "Undeploying…"
        : pendingAction?.type === "reset-key"
            ? "Resetting key…"
            : "Deploying…";

    // Rollback: promoting a version older than the one currently in production.
    const confirmProductionVersion = productionInstance
        ? trainingById[String(productionInstance.training_id)]?.version
        : null;
    const confirmIsRollback = confirmAction?.type === "deploy"
        && confirmAction.environment === "production"
        && confirmProductionVersion != null
        && confirmAction.training.version < confirmProductionVersion;
    const confirmIsProductionDeploy = confirmAction?.type === "deploy" && confirmAction.environment === "production";

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

            {loading ? (
                <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "40vh" }}>
                    <Spinner animation="border" variant="secondary" />
                </div>
            ) : (
                <>
                    <Row className="g-4 align-items-stretch">
                        <Col lg={6}>
                            <EnvironmentCard
                                environment={ENVIRONMENTS[0]}
                                instance={testingInstance}
                                training={testingInstance ? trainingById[String(testingInstance.training_id)] : null}
                                stale={isInstanceStale(testingInstance)}
                                busy={environmentBusy("testing")}
                                busyLabel={busyLabel}
                                onReload={() => openConfirm("reload", "testing", trainingById[String(testingInstance.training_id)] || { id: testingInstance.training_id })}
                                onUndeploy={() => openConfirm("undeploy", "testing", trainingById[String(testingInstance.training_id)])}
                                onResetKey={() => openConfirm("reset-key", "testing", trainingById[String(testingInstance.training_id)])}
                                onPromote={testingInstance ? () => openConfirm("deploy", "production", trainingById[String(testingInstance.training_id)]) : undefined}
                                live={Boolean(testingInstance && productionInstance
                                    && testingInstance.training_id === productionInstance.training_id)}
                            />
                        </Col>
                        <Col lg={6}>
                            <EnvironmentCard
                                environment={ENVIRONMENTS[1]}
                                instance={productionInstance}
                                training={productionInstance ? trainingById[String(productionInstance.training_id)] : null}
                                stale={isInstanceStale(productionInstance)}
                                busy={environmentBusy("production")}
                                busyLabel={busyLabel}
                                onReload={() => openConfirm("reload", "production", trainingById[String(productionInstance.training_id)] || { id: productionInstance.training_id })}
                                onUndeploy={() => openConfirm("undeploy", "production", trainingById[String(productionInstance.training_id)])}
                                onResetKey={() => openConfirm("reset-key", "production", trainingById[String(productionInstance.training_id)])}
                            />
                        </Col>
                    </Row>

                    <Row className="g-4 mt-1">
                        <Col>
                            <Card className="border-light overflow-hidden">
                                <CardHeading
                                    icon={<RocketTakeoff />}
                                    title="Releases"
                                    right={
                                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                                            Deploy a version to testing, then promote it from the Testing card above.
                                        </span>
                                    }
                                />
                                <Card.Body className="p-0">
                                    {trainings.length === 0 ? (
                                        <Alert variant="warning" className="d-flex align-items-start gap-2 small m-3">
                                            <InfoCircle className="mt-1 flex-shrink-0" />
                                            <span>
                                                No successfully trained versions yet. Train one from
                                                the <Link to={`/models/${modelId}/history`}>History</Link> tab, then come back to publish it.
                                            </span>
                                        </Alert>
                                    ) : (
                                        <Table responsive hover className="mb-0 align-middle text-center">
                                            <thead>
                                                <tr>
                                                    <th><Hash className="text-muted" />&nbsp;Version</th>
                                                    <th><GraphUp className="text-muted" />&nbsp;Test Accuracy (%)</th>
                                                    <th><Clock className="text-muted" />&nbsp;Trained On</th>
                                                    <th><HddStack className="text-muted" />&nbsp;Environments</th>
                                                    <th><Option className="text-muted" />&nbsp;Options</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {trainings.map((training) => {
                                                    const inTesting = testingInstance?.training_id === training.id;
                                                    const inProduction = productionInstance?.training_id === training.id;
                                                    const accuracy = getTrainingAccuracy(training);
                                                    const deployingHere = pendingAction?.type === "deploy"
                                                        && pendingAction.environment === "testing"
                                                        && pendingAction.trainingId === training.id;
                                                    return (
                                                        <tr key={training.id}>
                                                            <td>
                                                                <Link to={`/models/${modelId}/history/${training.id}`} className="text-decoration-none font-monospace">
                                                                    v{training.version}
                                                                </Link>
                                                            </td>
                                                            <td className="font-monospace">
                                                                {accuracy !== null ? (accuracy * 100).toFixed(2) : "-"}
                                                            </td>
                                                            <td className="small text-muted">{training.date_done || training.created_at}</td>
                                                            <td>
                                                                <span className="d-inline-flex align-items-center gap-1">
                                                                    {inTesting && <Badge bg="info">testing</Badge>}
                                                                    {inProduction && <Badge bg="success">production</Badge>}
                                                                    {!inTesting && !inProduction && <span className="text-muted small">-</span>}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <Button
                                                                    variant="light"
                                                                    size="sm"
                                                                    className="border d-inline-flex align-items-center gap-1"
                                                                    disabled={Boolean(pendingAction) || inTesting}
                                                                    title={inTesting ? "Already deployed in testing" : "Deploy this version to testing"}
                                                                    onClick={() => openConfirm("deploy", "testing", training)}
                                                                >
                                                                    {deployingHere ? (
                                                                        <Spinner animation="border" size="sm" />
                                                                    ) : (
                                                                        <CloudPlus />
                                                                    )}
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            <Modal centered show={Boolean(confirmAction)} onHide={closeConfirm}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">
                        {confirmAction?.type === "undeploy"
                            ? `Undeploy from ${confirmAction.environment}`
                            : confirmAction?.type === "reset-key"
                                ? `Reset ${confirmAction.environment} API key`
                                : confirmAction?.type === "reload"
                                    ? `Redeploy in ${confirmAction.environment}`
                                    : confirmIsRollback
                                ? "Roll back production"
                                : confirmIsProductionDeploy
                                    ? "Promote to production"
                                    : "Deploy to testing"}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {confirmAction?.type === "undeploy" ? (
                        <p className="small">
                            Undeploy v{confirmAction.training?.version} from <strong>{confirmAction.environment}</strong>?
                            The environment will stop serving predictions immediately.
                        </p>
                    ) : confirmAction?.type === "reset-key" ? (
                        <p className="small">
                            Generate a new API key for the <strong>{confirmAction.environment}</strong> deployment?
                            Requests using the current key will stop working immediately.
                        </p>
                    ) : confirmAction?.type === "reload" ? (
                        <p className="small">
                            Redeploy v{confirmAction.training?.version} in <strong>{confirmAction.environment}</strong>?
                            The instance will restart and serve the latest trained model for this version.
                        </p>
                    ) : confirmIsProductionDeploy ? (
                        <>
                            <p className="small">
                                {confirmIsRollback ? (
                                    <>Roll back <strong>production</strong> from v{confirmProductionVersion} to v{confirmAction?.training?.version}?</>
                                ) : confirmProductionVersion != null ? (
                                    <>Promote v{confirmAction?.training?.version} to <strong>production</strong>, replacing v{confirmProductionVersion}?</>
                                ) : (
                                    <>Promote v{confirmAction?.training?.version} to <strong>production</strong>?</>
                                )}
                                &nbsp;Live traffic will be served by this version once it starts.
                            </p>
                            <Form.Check
                                type="checkbox"
                                id="validated-in-testing"
                                className="small mb-3"
                                label="I have validated this version in the testing environment."
                                checked={validatedInTesting}
                                onChange={(event) => setValidatedInTesting(event.target.checked)}
                            />
                        </>
                    ) : (
                        <p className="small">
                            Deploy v{confirmAction?.training?.version} to <strong>testing</strong>?
                            {testingInstance && confirmAction?.training && testingInstance.training_id !== confirmAction.training.id && (
                                <> This replaces v{trainingById[String(testingInstance.training_id)]?.version} currently deployed there.</>
                            )}
                        </p>
                    )}
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" className="border small" onClick={closeConfirm}>CANCEL</Button>
                        <Button
                            variant={confirmAction?.type === "undeploy"
                                ? "danger"
                                : confirmAction?.type === "reset-key" || confirmIsRollback
                                    ? "warning"
                                    : "primary"}
                            size="sm"
                            className="small"
                            disabled={confirmIsProductionDeploy && !validatedInTesting}
                            onClick={submitConfirm}
                        >
                            {confirmAction?.type === "undeploy"
                                ? "UNDEPLOY"
                                : confirmAction?.type === "reset-key"
                                    ? "RESET KEY"
                                    : confirmAction?.type === "reload"
                                        ? "REDEPLOY"
                                        : confirmIsRollback
                                            ? "ROLL BACK"
                                            : confirmIsProductionDeploy
                                                ? "PROMOTE"
                                                : "DEPLOY"}
                        </Button>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
};

export default Publish;
