import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Tab, Table, Tabs } from "react-bootstrap";
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
    Gear,
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
import { useTheme } from "../../../../contexts/ThemeContext";
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

// Reveal only the first third of the key (rest stays masked) so a shoulder-surfer
// can verify which key it is without seeing the whole secret.
const maskApiKey = (key) => {
    const visible = Math.max(1, Math.ceil(key.length / 3));
    return key.slice(0, visible) + "•".repeat(key.length - visible);
};

const getTrainingAccuracy = (training) => {
    const result = training?.result;
    if (!result) return null;
    return result.accuracy ?? result.evaluation?.test?.accuracy ?? null;
};

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

const EnvironmentCard = ({
    environment,
    instance,
    training,
    stale,
    busy,
    busyLabel,
    onRestart,
    onStop,
    onPromote,
    live,
    onResetKey,
    onConfigure
}) => {
    const { theme } = useTheme();
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
        `curl -X POST '${inferUrl}?top=${instance.config?.top ?? 1}'`,
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
                            <span className="text-primary fs-4 fw-bold font-monospace"><Hash /></span>
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
                                            ? `v${training?.version} is live — stop it from the Production card`
                                            : `Promote v${training?.version} to production`}
                                    />
                                    {live ? (
                                        <span className="text-muted text-end" style={{ fontSize: "0.7rem" }}>
                                            Use the stop button to stop.
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
                            <Clock className="text-primary flex-shrink-0" />
                            <span>Deployed at {instance.date_receive || "-"}</span>
                        </div>
                        {instance.api_key && (
                            <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                                <Key className="text-primary flex-shrink-0" />
                                <span className="font-monospace text-truncate flex-grow-1" style={{ minWidth: 0 }}>
                                    {showKey ? maskApiKey(instance.api_key) : "•".repeat(instance.api_key.length)}
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
                                    title="Reset API Key"
                                >
                                    <ArrowRepeat />
                                </Button>
                            </div>
                        )}
                        <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                            <Link45deg className="text-primary flex-shrink-0" />
                            <span className="fw-bold" style={{ fontSize: "0.7rem" }}>
                                <Badge className="border" bg={theme} text={theme === "dark" ? "light" : "dark"} style={{ fontSize: "0.7rem" }}>
                                    POST
                                </Badge>
                            </span>
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
                                    v{training?.version} was retrained after this deployment. Restart to serve the latest model.
                                </span>
                            </Alert>
                        )}
                        <div className="d-flex align-items-center gap-2 mt-auto pt-3">
                            {onStop && (
                                <Button
                                    variant="light"
                                    size="sm"
                                    className="border text-danger d-inline-flex align-items-center gap-1"
                                    disabled={busy}
                                    onClick={onStop}
                                    title={`Stop v${training?.version} from ${environment.name}`}
                                >
                                    <Stop />
                                </Button>
                            )}
                            <Button
                                variant="light"
                                size="sm"
                                className="border d-inline-flex align-items-center gap-1"
                                disabled={busy}
                                onClick={onRestart}
                                title={`Redeploy v${training?.version} in ${environment.name}`}
                            >
                                <ArrowClockwise />
                            </Button>
                            <Button
                                variant="light"
                                size="sm"
                                className="border d-inline-flex align-items-center gap-1"
                                disabled={busy}
                                onClick={onConfigure}
                                title={`Deployment configuration for ${environment.name}`}
                            >
                                <Gear />
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

// Client-side mirror of the server's default deployment configuration,
// used to prefill the form when nothing is deployed yet.
const DEFAULT_CONFIG = {
    lazy: false,
    cache: true,
    top: 1,
    timeout: 30,
    interval: 0.01,
    batch_size: 32,
    sleep: 0.005,
    idle_timeout: 300,
    heartbeat_interval: 5,
    heartbeat_ttl: 15,
    output_ttl: 300
};

// Build the string-valued form state from an instance config (or defaults).
const toConfigForm = (config) => {
    const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
    return {
        lazy: Boolean(merged.lazy),
        cache: merged.cache !== false,
        top: String(merged.top),
        timeout: String(merged.timeout),
        interval: String(merged.interval),
        batch_size: String(merged.batch_size),
        sleep: String(merged.sleep),
        idle_timeout: String(merged.idle_timeout),
        heartbeat_interval: String(merged.heartbeat_interval),
        heartbeat_ttl: String(merged.heartbeat_ttl),
        output_ttl: String(merged.output_ttl)
    };
};

// Validate the form and convert it back into a config payload.
// Mirrors the server-side validation. Returns { config } or { error }.
const parseConfigForm = (form) => {
    // [field, label, integer]: integers must be whole numbers >= 1,
    // the rest positive numbers of seconds.
    const numericFields = [
        ["top", "Top predictions", true],
        ["batch_size", "Batch size", true],
        ["output_ttl", "Output TTL", true],
        ["heartbeat_ttl", "Heartbeat TTL", true],
        ["timeout", "Timeout", false],
        ["interval", "Interval", false],
        ["sleep", "Sleep", false],
        ["idle_timeout", "Idle timeout", false],
        ["heartbeat_interval", "Heartbeat interval", false]
    ];
    const numbers = {};
    for (const [field, label, integer] of numericFields) {
        const value = Number(form[field]);
        if (integer ? !Number.isInteger(value) || value < 1 : !Number.isFinite(value) || value <= 0) {
            return { error: `${label} must be ${integer ? "a whole number of at least 1" : "a positive number of seconds"}.` };
        }
        numbers[field] = value;
    }
    if (numbers.interval > numbers.timeout) {
        return { error: "Interval cannot exceed the timeout." };
    }
    if (numbers.heartbeat_interval >= numbers.heartbeat_ttl) {
        return { error: "Heartbeat TTL must exceed the heartbeat interval." };
    }
    return { config: { lazy: form.lazy, cache: form.cache, ...numbers } };
};

// A numeric field of the deployment configuration form.
const ConfigField = ({ id, label, help, step, value, onChange, disabled }) => (
    <Form.Group className="mb-3" controlId={id}>
        <Form.Label className="small fw-bold mb-1">{label}</Form.Label>
        <Form.Control type="number" size="sm" min={0} step={step} value={value} onChange={onChange} disabled={disabled} />
        <Form.Text className="text-muted" style={{ fontSize: "0.7rem" }}>{help}</Form.Text>
    </Form.Group>
);

// The deployment configuration form, shared by the configure modal and the
// deploy / promote confirmations. `onChange(field, value)` updates one field.
const ConfigFormFields = ({ form, onChange }) => (
    <Tabs variant="pills" defaultActiveKey="model" className="small mb-3" justify>
        <Tab eventKey="model" title="Model">
            <Form.Check
                type="switch"
                id="config-lazy"
                className="small"
                label="Lazy loading"
                checked={form.lazy}
                onChange={(event) => onChange("lazy", event.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ fontSize: "0.7rem" }}>
                Start the model on the first prediction request and shut it down
                when idle. When disabled, the task starts at deploy time and stays
                resident until stoped.
            </Form.Text>
            <Row>
                <Col sm={6}>
                    <ConfigField
                        id="config-batch-size"
                        label="Batch size"
                        help="Maximum queries predicted in one batch."
                        step={1}
                        value={form.batch_size}
                        onChange={(event) => onChange("batch_size", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-sleep"
                        label="Sleep (s)"
                        help="Pause between polls when no queries are waiting."
                        step={0.001}
                        value={form.sleep}
                        onChange={(event) => onChange("sleep", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-heartbeat-interval"
                        label="Heartbeat interval (s)"
                        help="How often the task reports itself alive."
                        step={1}
                        value={form.heartbeat_interval}
                        onChange={(event) => onChange("heartbeat_interval", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-heartbeat-ttl"
                        label="Heartbeat TTL (s)"
                        help="How long a heartbeat keeps the task marked alive."
                        step={1}
                        value={form.heartbeat_ttl}
                        onChange={(event) => onChange("heartbeat_ttl", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-idle-timeout"
                        label="Idle timeout (s)"
                        help="Time without requests before a lazily loaded task shuts down."
                        step={1}
                        value={form.idle_timeout}
                        onChange={(event) => onChange("idle_timeout", event.target.value)}
                        disabled={!form.lazy}
                    />
                </Col>
            </Row>
        </Tab>
        <Tab eventKey="server" title="Server">
            <Form.Check
                type="switch"
                id="config-cache"
                className="small"
                label="Response caching"
                checked={form.cache}
                onChange={(event) => onChange("cache", event.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ fontSize: "0.7rem" }}>
                Serve repeated identical queries from cache. When disabled, every request
                runs inference and its prediction is discarded once delivered.
            </Form.Text>
            {!form.cache && (
                <Alert variant="warning" className="py-2 small mt-2">
                    Existing cached predictions will be permanently deleted when this configuration is applied.
                </Alert>
            )}
            <Row>
                <Col sm={6}>
                    <ConfigField
                        id="config-top"
                        label="Top predictions"
                        help={<>Predictions returned when a request omits <code>top</code>.</>}
                        step={1}
                        value={form.top}
                        onChange={(event) => onChange("top", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-output-ttl"
                        label="Output TTL (s)"
                        help="How long cached predictions stay available."
                        step={1}
                        value={form.output_ttl}
                        onChange={(event) => onChange("output_ttl", event.target.value)}
                        disabled={!form.cache}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-timeout"
                        label="Timeout (s)"
                        help="How long a request waits for a prediction before failing."
                        step={1}
                        value={form.timeout}
                        onChange={(event) => onChange("timeout", event.target.value)}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-interval"
                        label="Interval (s)"
                        help="How often a waiting request polls for its prediction."
                        step={0.01}
                        value={form.interval}
                        onChange={(event) => onChange("interval", event.target.value)}
                    />
                </Col>
            </Row>
        </Tab>
    </Tabs>
);

const Publish = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const socket = useSocket();

    const [trainings, setTrainings] = useState([]);
    const [instances, setInstances] = useState([]);
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(true);
    // { type: 'deploy' | 'stop', environment, trainingId } while a request is in flight.
    const [pendingAction, setPendingAction] = useState(null);
    // { type: 'deploy' | 'stop', environment, training } awaiting confirmation.
    const [confirmAction, setConfirmAction] = useState(null);
    const [validatedInTesting, setValidatedInTesting] = useState(false);
    // { environment, instance } while the deployment configuration modal is open.
    const [configTarget, setConfigTarget] = useState(null);
    // Numeric fields are kept as strings while editing and parsed on save.
    const [configForm, setConfigForm] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [configSaving, setConfigSaving] = useState(false);
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

    const handleDeploy = async (environment, trainingId, config = null) => {
        setPendingAction({ type: "deploy", environment, trainingId });
        setAlert(null);
        try {
            const response = await axios.post(
                `/api/models/${modelId}/instances`,
                // Restarts send no config: the server keeps the current one.
                config ? { [environment]: true, config } : { [environment]: true },
                { params: { training_id: trainingId }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setInstances(response.data.instances || []);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setPendingAction(null);
        }
    };

    const handleStop = async (environment) => {
        const instance = instanceByEnvironment[environment];
        if (!instance) return;
        setPendingAction({ type: "stop", environment, trainingId: instance.training_id });
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

    const openConfig = (environment) => {
        const instance = instanceByEnvironment[environment];
        if (!instance) return;
        setConfigForm(toConfigForm(instance.config));
        setConfigError(null);
        setConfigTarget({ environment, instance });
    };

    const closeConfig = (preserveForm = false) => {
        if (configSaving) return;

        setConfigTarget(null);

        if (!preserveForm) {
            setConfigForm(null);
        }

        setConfigError(null);
    };

    const changeConfig = (field, value) => (
        setConfigForm((prev) => ({ ...prev, [field]: value }))
    );

    const submitConfig = async () => {
        const { config, error } = parseConfigForm(configForm);
        if (error) {
            setConfigError(error);
            return;
        }
        setConfigSaving(true);
        setConfigError(null);
        try {
            if (configTarget.instance) {
                const response = await axios.put(
                    `/api/models/${modelId}/instances/${configTarget.instance.id}`,
                    { config },
                    { headers: { Authorization: `Bearer ${user.token}` } }
                );
                setInstances((prev) => prev.map((item) => (
                    item.id === response.data.instance.id ? response.data.instance : item
                )));
                setConfigTarget(null);
                setConfigForm(null);
            } else {
                const target = configTarget;

                closeConfig(true);

                setConfirmAction({
                    type: "deploy",
                    environment: target.environment,
                    training: target.training,
                    config
                });

                return;
            }
        } catch (error) {
            setConfigError(error.response?.data?.error || error.message);
        } finally {
            setConfigSaving(false);
            // Only close the configuration modal for the configure flow.
            // Deploy/promote closes it explicitly before opening confirmation.
            if (configTarget?.instance) {
                closeConfig();
            }
        }
    };

    const openConfirm = (type, environment, training) => {
        setValidatedInTesting(false);
        if (type === "deploy") {
            const source =
                environment === "production"
                    ? (
                        instanceByEnvironment.testing?.config ??
                        instanceByEnvironment.production?.config ??
                        DEFAULT_CONFIG
                    )
                    : (
                        instanceByEnvironment.testing?.config ??
                        DEFAULT_CONFIG
                    );

            setConfigForm(toConfigForm(source));
            setConfigTarget({
                environment,
                training
            });

            return;
        }
        setConfirmAction({ type, environment, training });
    };

    const closeConfirm = () => {
        setConfirmAction(null);
        setConfigForm(null);
        setConfigTarget(null);
        setConfigError(null);
        setValidatedInTesting(false);
    };

    const submitConfirm = async () => {
        const action = confirmAction;
        if (!action) return;

        setConfirmAction(null);
        setConfigError(null);

        if (action.type === "deploy") {
            await handleDeploy(
                action.environment,
                action.training.id,
                action.config
            );
            return;
        }

        if (action.type === "restart") {
            await handleDeploy(
                action.environment,
                action.training.id
            );
            return;
        }

        if (action.type === "stop") {
            await handleStop(action.environment);
            return;
        }

        if (action.type === "reset-key") {
            await handleResetKey(action.environment);
        }
    };

    const environmentBusy = (environment) => pendingAction?.environment === environment;

    const busyLabel = pendingAction?.type === "stop"
        ? "Stopping…"
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
                                onRestart={() => openConfirm("restart", "testing", trainingById[String(testingInstance.training_id)] || { id: testingInstance.training_id })}
                                onStop={() => openConfirm("stop", "testing", trainingById[String(testingInstance.training_id)])}
                                onResetKey={() => openConfirm("reset-key", "testing", trainingById[String(testingInstance.training_id)])}
                                onConfigure={() => openConfig("testing")}
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
                                onRestart={() => openConfirm("restart", "production", trainingById[String(productionInstance.training_id)] || { id: productionInstance.training_id })}
                                onStop={() => openConfirm("stop", "production", trainingById[String(productionInstance.training_id)])}
                                onResetKey={() => openConfirm("reset-key", "production", trainingById[String(productionInstance.training_id)])}
                                onConfigure={() => openConfig("production")}
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

            <Modal size={confirmAction?.type === "deploy" ? "lg" : undefined} centered scrollable show={Boolean(confirmAction)} onHide={closeConfirm}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">
                        {confirmAction?.type === "stop"
                            ? `Stop ${confirmAction.environment}`
                            : confirmAction?.type === "reset-key"
                                ? `Reset ${confirmAction.environment} API key`
                                : confirmAction?.type === "restart"
                                    ? `Redeploy in ${confirmAction.environment}`
                                    : confirmIsRollback
                                        ? "Roll back production"
                                        : confirmIsProductionDeploy
                                            ? "Promote to production"
                                            : "Deploy to testing"}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {confirmAction?.type === "stop" ? (
                        <p className="small">
                            Stop v{confirmAction.training?.version} from <strong>{confirmAction.environment}</strong>?
                            The environment will stop serving predictions immediately.
                        </p>
                    ) : confirmAction?.type === "reset-key" ? (
                        <p className="small">
                            Generate a new API key for the <strong>{confirmAction.environment}</strong> deployment?
                            Requests using the current key will stop working immediately.
                        </p>
                    ) : confirmAction?.type === "restart" ? (
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
                            {configError && (
                                <Alert variant="danger" className="small py-2">
                                    {configError}
                                </Alert>
                            )}

                            {configTarget && configForm && (
                                <ConfigFormFields
                                    form={configForm}
                                    onChange={changeConfig}
                                />
                            )}
                        </>
                    ) : (
                        <>
                            <p className="small">
                                Deploy v{confirmAction?.training?.version} to <strong>testing</strong>?
                                {testingInstance &&
                                    confirmAction?.training &&
                                    testingInstance.training_id !== confirmAction.training.id && (
                                        <>
                                            {" "}
                                            This replaces v{
                                                trainingById[String(testingInstance.training_id)]?.version
                                            } currently deployed there.
                                        </>
                                    )}
                            </p>

                            {configError && (
                                <Alert variant="danger" className="small py-2">
                                    {configError}
                                </Alert>
                            )}

                            {configTarget && configForm && (
                                <ConfigFormFields
                                    form={configForm}
                                    onChange={changeConfig}
                                />
                            )}
                        </>
                    )}
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" className="border small" onClick={closeConfirm}>CANCEL</Button>
                        <Button
                            variant={confirmAction?.type === "stop"
                                ? "danger"
                                : confirmAction?.type === "reset-key" || confirmIsRollback
                                    ? "warning"
                                    : "primary"}
                            size="sm"
                            className="small"
                            disabled={confirmIsProductionDeploy && !validatedInTesting}
                            onClick={submitConfirm}
                        >
                            {confirmAction?.type === "stop"
                                ? "STOP"
                                : confirmAction?.type === "reset-key"
                                    ? "RESET KEY"
                                    : confirmAction?.type === "restart"
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

            <Modal size="lg" centered scrollable show={Boolean(configTarget)} onHide={closeConfig}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted d-inline-flex align-items-center gap-2">
                        <Gear /> Deployment configuration — {configTarget?.environment}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {configError && (
                        <Alert variant="danger" className="small py-2">{configError}</Alert>
                    )}
                    {configForm && (
                        <Form onSubmit={(event) => { event.preventDefault(); submitConfig(); }}>
                            <ConfigFormFields
                                form={configForm}
                                onChange={changeConfig}
                            />
                            <div className="d-flex justify-content-end gap-2">
                                <Button variant="light" size="sm" className="border small" disabled={configSaving} onClick={closeConfig}>
                                    CANCEL
                                </Button>
                                <Button variant="primary" size="sm" className="small d-inline-flex align-items-center gap-2" type="submit" disabled={configSaving}>
                                    {configSaving && <Spinner animation="border" size="sm" />}
                                    {configTarget?.instance ? "SAVE" : "CONTINUE"}
                                </Button>
                            </div>
                        </Form>
                    )}
                </Modal.Body>
            </Modal>
        </div>
    );
};

export default Publish;
