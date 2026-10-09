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
import { ModelContext } from "../../../../contexts/ModelContext";
import { useSocket } from "../../../../contexts/SocketContext";
import { useTheme } from "../../../../contexts/ThemeContext";
import { CardHeading } from "../../../../shared/components/SectionCard";
import { formatThreshold, getThresholds, getTrainingAccuracy, parseApiDate } from "../../../../shared/utils/training";
import { useApi } from "../../../../contexts/ApiContext";

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

// Reveal only the first third of the key (rest stays masked) so a shoulder-surfer
// can verify which key it is without seeing the whole secret.
const maskApiKey = (key) => {
    const visible = Math.max(1, Math.ceil(key.length / 3));
    return key.slice(0, visible) + "•".repeat(key.length - visible);
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
    // The endpoint is batch-only: an "inputs" list body returns an
    // index-aligned {"outputs": [...]} list, one element per input. A single
    // prediction is just a one-element list.
    const curlSnippet = instance ? [
        `curl -X POST '${inferUrl}?top=${instance.config?.top ?? 1}${
            instance.config?.label_threshold
                ? `&label_threshold=${instance.config.label_threshold}` : ""
        }${
            instance.config?.annotation_threshold
                ? `&annotation_threshold=${instance.config.annotation_threshold}` : ""
        }'`,
        `  -H 'Authorization: Bearer ${instance.api_key}'`,
        `  -H 'Content-Type: application/json'`,
        `  -d '{"inputs": ["Hello there", "General Kenobi"]}'`
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
                                        <span className="text-muted text-end" style={{ fontSize: "var(--app-text-xs)" }}>
                                            Use the stop button to stop.
                                        </span>
                                    ) : (
                                        <span className="text-muted text-end" style={{ fontSize: "var(--app-text-xs)" }}>
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
                        {instance.api_key_expiry && (
                            <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                                <ShieldCheck className="text-primary flex-shrink-0" />
                                <span>Key expires {instance.api_key_expiry}</span>
                            </div>
                        )}
                        <div className="small text-muted d-flex align-items-center gap-2 mb-1">
                            <Link45deg className="text-primary flex-shrink-0" />
                            <span className="fw-bold" style={{ fontSize: "var(--app-text-xs)" }}>
                                <Badge className="border" bg={theme} text={theme === "dark" ? "light" : "dark"} style={{ fontSize: "var(--app-text-xs)" }}>
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
                        <p className="mb-0 text-muted" style={{ fontSize: "var(--app-text-xs)", maxWidth: "260px" }}>
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
    // 0 means off: mirrors the server default so an unconfigured deployment
    // keeps returning everything the model predicts.
    label_threshold: 0.0,
    annotation_threshold: 0.0,
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
        label_threshold: String(merged.label_threshold),
        annotation_threshold: String(merged.annotation_threshold),
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

// [field, label, integer]: integers must be whole numbers >= 1,
// the rest positive numbers of seconds.
const CONFIG_NUMERIC_FIELDS = [
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

// Thresholds validate differently from every other numeric field: they are
// bounded to 0-1 and 0 is a legal value, meaning "no cutoff".
const CONFIG_THRESHOLD_FIELDS = [
    ["label_threshold", "Label threshold"],
    ["annotation_threshold", "Annotation threshold"]
];

// Tab that owns each numeric field, used to jump to the first invalid
// input when the form is submitted from another tab.
const CONFIG_FIELD_TABS = {
    batch_size: "model",
    sleep: "model",
    heartbeat_interval: "model",
    heartbeat_ttl: "model",
    idle_timeout: "model",
    top: "server",
    output_ttl: "server",
    timeout: "server",
    interval: "server",
    label_threshold: "server",
    annotation_threshold: "server"
};

// Per-field check used for the inline feedback; returns a message or null.
const validateConfigField = (field, form) => {
    if (CONFIG_THRESHOLD_FIELDS.some(([name]) => name === field)) {
        const value = Number(form[field]);
        return form[field] === "" || !Number.isFinite(value) || value < 0 || value > 1
            ? "Must be a number between 0 and 1."
            : null;
    }
    const rule = CONFIG_NUMERIC_FIELDS.find(([name]) => name === field);
    if (!rule) return null;
    const [, , integer] = rule;
    const value = Number(form[field]);
    if (form[field] === "" || (integer ? !Number.isInteger(value) || value < 1 : !Number.isFinite(value) || value <= 0)) {
        return integer ? "Must be a whole number of at least 1." : "Must be a positive number of seconds.";
    }
    if (field === "interval" && Number.isFinite(Number(form.timeout)) && value > Number(form.timeout)) {
        return "Cannot exceed the timeout.";
    }
    if (field === "heartbeat_ttl" && Number.isFinite(Number(form.heartbeat_interval)) && Number(form.heartbeat_interval) >= value) {
        return "Must exceed the heartbeat interval.";
    }
    return null;
};

// Numeric fields currently editable given the lazy/cache switches; disabled
// fields keep their last values and are skipped by the inline validation.
const getEditableConfigFields = (form) => [
    ...CONFIG_NUMERIC_FIELDS.map(([field]) => field),
    ...CONFIG_THRESHOLD_FIELDS.map(([field]) => field)
]
    .filter((field) => (
        field === "idle_timeout" ? form.lazy
            : field === "output_ttl" ? form.cache
                : true
    ));

// Validate the form and convert it back into a config payload.
// Mirrors the server-side validation. Returns { config } or { error }.
const parseConfigForm = (form) => {
    const numbers = {};
    for (const [field, label, integer] of CONFIG_NUMERIC_FIELDS) {
        const value = Number(form[field]);
        if (integer ? !Number.isInteger(value) || value < 1 : !Number.isFinite(value) || value <= 0) {
            return { error: `${label} must be ${integer ? "a whole number of at least 1" : "a positive number of seconds"}.` };
        }
        numbers[field] = value;
    }
    for (const [field, label] of CONFIG_THRESHOLD_FIELDS) {
        const value = Number(form[field]);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            return { error: `${label} must be a number between 0 and 1.` };
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
const ConfigField = ({ id, label, help, step, value, onChange, disabled, error }) => (
    <Form.Group className="mb-3" controlId={id}>
        <Form.Label className="small fw-bold mb-1">{label}</Form.Label>
        <Form.Control type="number" size="sm" min={0} step={step} value={value} onChange={onChange} disabled={disabled} isInvalid={Boolean(error)} />
        <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
        <Form.Text className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>{help}</Form.Text>
    </Form.Group>
);

// The deployment configuration form, shared by the configure modal and the
// deploy / promote confirmations. `onChange(field, value)` updates one field.
// `training` is the version being deployed (or, when editing an already-
// deployed instance, the version currently serving) — it backs the threshold
// recommendations below.
const ConfigFormFields = ({ form, onChange, errors = {}, activeTab, onTabChange, training, kind }) => {
    // Offered, never applied: enforcing a cutoff should be a deliberate act,
    // and this number is per-version, so it would otherwise shift underneath
    // the operator on every republish.
    // A cutoff is only meaningful for a head the model actually has: a
    // classifier discards annotation_threshold and a named entity recognition
    // model discards label_threshold. Both stay in the submitted config at
    // their 0.0 default — this hides the control, not the field.
    const hasLabelHead = kind !== "named_entity_recognition";
    const hasAnnotationHead = kind !== "text_classification";
    const labelRecommendation = getThresholds(training, "test", "intent")?.threshold ?? null;
    const annotationRecommendation = getThresholds(training, "test", "slots")?.threshold ?? null;

    return (
    <Tabs variant="pills" activeKey={activeTab} onSelect={onTabChange} className="small mb-3" justify>
        <Tab eventKey="model" title="Model">
            <Form.Check
                type="switch"
                id="config-lazy"
                className="small"
                label="Lazy loading"
                checked={form.lazy}
                onChange={(event) => onChange("lazy", event.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ fontSize: "var(--app-text-xs)" }}>
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
                        error={errors.batch_size}
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
                        error={errors.sleep}
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
                        error={errors.heartbeat_interval}
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
                        error={errors.heartbeat_ttl}
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
                        error={errors.idle_timeout}
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
            <Form.Text className="text-muted d-block mb-3" style={{ fontSize: "var(--app-text-xs)" }}>
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
                        error={errors.top}
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
                        error={errors.output_ttl}
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
                        error={errors.timeout}
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
                        error={errors.interval}
                    />
                </Col>
                {hasLabelHead && <Col sm={6}>
                    <ConfigField
                        id="config-label-threshold"
                        label="Label threshold"
                        help={
                            <>
                                Below this score the top label is returned with no name. 0 turns it off.
                                {labelRecommendation !== null && (
                                    <> Recommended <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 align-baseline"
                                        onClick={() => onChange("label_threshold", String(labelRecommendation))}
                                    >{formatThreshold(labelRecommendation)}</Button> from this version.</>
                                )}
                            </>
                        }
                        step="any"
                        value={form.label_threshold}
                        onChange={(event) => onChange("label_threshold", event.target.value)}
                        error={errors.label_threshold}
                    />
                </Col>}
                {hasAnnotationHead && <Col sm={6}>
                    <ConfigField
                        id="config-annotation-threshold"
                        label="Annotation threshold"
                        help={
                            <>
                                Annotations scoring below this are dropped. 0 turns it off.
                                {annotationRecommendation !== null && (
                                    <> Recommended <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 align-baseline"
                                        onClick={() => onChange("annotation_threshold", String(annotationRecommendation))}
                                    >{formatThreshold(annotationRecommendation)}</Button> from this version.</>
                                )}
                            </>
                        }
                        step="any"
                        value={form.annotation_threshold}
                        onChange={(event) => onChange("annotation_threshold", event.target.value)}
                        error={errors.annotation_threshold}
                    />
                </Col>}
            </Row>
        </Tab>
    </Tabs>
    );
};

// Read-only recap of the chosen deployment configuration, shown in the
// deploy/promote confirmation step.
const CONFIG_SUMMARY_LABELS = [
    ["lazy", "Lazy loading"],
    ["cache", "Response caching"],
    ["batch_size", "Batch size"],
    ["sleep", "Sleep (s)"],
    ["heartbeat_interval", "Heartbeat interval (s)"],
    ["heartbeat_ttl", "Heartbeat TTL (s)"],
    ["idle_timeout", "Idle timeout (s)"],
    ["top", "Top predictions"],
    ["output_ttl", "Output TTL (s)"],
    ["timeout", "Timeout (s)"],
    ["interval", "Interval (s)"],
    ["label_threshold", "Label threshold"],
    ["annotation_threshold", "Annotation threshold"]
];

const ConfigSummary = ({ config }) => (
    <div className="border border-light-subtle rounded mb-3 overflow-auto" style={{ maxHeight: "40vh" }}>
        <Row className="g-0">
            {CONFIG_SUMMARY_LABELS.map(([field, label], index) => (
                <Col sm={6} key={field}>
                    <div
                        className={`d-flex justify-content-between gap-3 px-3 py-2 small${index > 1 ? " border-top border-light-subtle" : ""}${index % 2 === 1 ? " border-start border-light-subtle" : ""}`}
                    >
                        <span className="text-muted fw-bold">{label}</span>
                        <span className="font-monospace">
                            {typeof config[field] === "boolean" ? (config[field] ? "on" : "off") : String(config[field])}
                        </span>
                    </div>
                </Col>
            ))}
        </Row>
    </div>
);

const Publish = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const api = useApi();
    // Only to decide which threshold controls are meaningful for this model
    // type; the config payload carries both fields either way.
    const { model } = useContext(ModelContext);
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
    // Per-field inline validation messages, keyed by field name.
    const [configErrors, setConfigErrors] = useState({});
    const [configTab, setConfigTab] = useState("model");
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
        const load = async () => {
            try {
                setLoading(true);
                const [trainingsData, instancesData] = await Promise.all([
                    api.trainings.list(modelId, { per_page: 100 }),
                    api.instances.list(modelId)
                ]);
                const successful = (trainingsData.trainings || [])
                    .filter((training) => training.status === "SUCCESS")
                    .sort((a, b) => b.version - a.version);
                setTrainings(successful);
                setInstances(instancesData.instances || []);
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
            // Restarts send no config: the server keeps the current one.
            const { instances } = await api.instances.deploy(
                modelId,
                config ? { [environment]: true, config } : { [environment]: true },
                trainingId
            );
            setInstances(instances || []);
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
            const { instances } = await api.instances.deploy(
                modelId, { [environment]: false }, instance.training_id
            );
            setInstances(instances || []);
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
            const { instance: rotated } = await api.instances.update(modelId, instance.id, { api_key: null });
            setInstances((prev) => prev.map((item) => (item.id === rotated.id ? rotated : item)));
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
        setConfigErrors({});
        setConfigTab("model");
        setConfigTarget({ environment, instance });
    };

    // Closes the shared configuration/confirmation dialog entirely.
    const closeDialogs = () => {
        if (configSaving) return;
        setConfirmAction(null);
        setConfigTarget(null);
        setConfigForm(null);
        setConfigError(null);
        setConfigErrors({});
        setValidatedInTesting(false);
    };

    const changeConfig = (field, value) => {
        const next = { ...configForm, [field]: value };
        setConfigForm(next);
        setConfigErrors((prev) => {
            const message = validateConfigField(field, next);
            const updated = { ...prev };
            if (message) updated[field] = message;
            else delete updated[field];
            return updated;
        });
    };

    const submitConfig = async () => {
        // Inline validation first: flag every editable field and jump to the
        // tab holding the first invalid input instead of failing silently.
        const fields = getEditableConfigFields(configForm);
        const errors = {};
        fields.forEach((field) => {
            const message = validateConfigField(field, configForm);
            if (message) errors[field] = message;
        });
        setConfigErrors(errors);
        const firstInvalid = fields.find((field) => errors[field]);
        if (firstInvalid) {
            setConfigTab(CONFIG_FIELD_TABS[firstInvalid] || "model");
            return;
        }
        const { config, error } = parseConfigForm(configForm);
        if (error) {
            setConfigError(error);
            return;
        }

        if (!configTarget.instance) {
            // Deploy/promote: swap the dialog body to the confirmation step,
            // keeping the form state so BACK can return to it.
            const target = configTarget;
            setConfigTarget(null);
            setConfigError(null);
            setConfirmAction({
                type: "deploy",
                environment: target.environment,
                training: target.training,
                config
            });
            return;
        }

        setConfigSaving(true);
        setConfigError(null);
        try {
            const { instance: saved } = await api.instances.update(modelId, configTarget.instance.id, { config });
            setInstances((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
            setConfigTarget(null);
            setConfigForm(null);
        } catch (error) {
            setConfigError(error.response?.data?.error || error.message);
        } finally {
            setConfigSaving(false);
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
            setConfigErrors({});
            setConfigTab("model");
            setConfigTarget({
                environment,
                training
            });

            return;
        }
        setConfirmAction({ type, environment, training });
    };

    // BACK from a deploy/promote confirmation returns to the form step of
    // the same dialog, with the edits intact.
    const backToConfig = () => {
        const action = confirmAction;
        if (!action || action.type !== "deploy" || !configForm) return;
        setConfirmAction(null);
        setConfigTarget({ environment: action.environment, training: action.training });
    };

    const submitConfirm = async () => {
        const action = confirmAction;
        if (!action) return;

        setConfirmAction(null);
        setConfigError(null);
        setConfigForm(null);

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
            : "S";

    // Rollback: promoting a version older than the one currently in production.
    const confirmProductionVersion = productionInstance
        ? trainingById[String(productionInstance.training_id)]?.version
        : null;
    const confirmIsRollback = confirmAction?.type === "deploy"
        && confirmAction.environment === "production"
        && confirmProductionVersion != null
        && confirmAction.training.version < confirmProductionVersion;
    const confirmIsProductionDeploy = confirmAction?.type === "deploy" && confirmAction.environment === "production";

    // The version whose curve backs the threshold recommendations shown in
    // the config form: the version being deployed/promoted (configTarget.training),
    // or — when editing an already-deployed instance's configuration — the
    // version currently serving there (looked up from configTarget.instance).
    const configTraining = configTarget?.training
        ?? (configTarget?.instance ? trainingById[String(configTarget.instance.training_id)] : null);

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
                                        <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
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

            <Modal
                size={configTarget || confirmAction?.type === "deploy" ? "lg" : undefined}
                centered
                scrollable
                show={Boolean(configTarget) || Boolean(confirmAction)}
                onHide={closeDialogs}
            >
                <Modal.Header closeButton={!configSaving}>
                    <Modal.Title className="small fw-bold text-muted d-inline-flex align-items-center gap-2">
                        {configTarget
                            ? <><Gear /> Deployment configuration — {configTarget.environment}</>
                            : confirmAction?.type === "stop"
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
                    {configTarget ? (
                        <>
                            {configError && (
                                <Alert variant="danger" className="small py-2">{configError}</Alert>
                            )}
                            {configForm && (
                                <Form noValidate onSubmit={(event) => { event.preventDefault(); submitConfig(); }}>
                                    <ConfigFormFields
                                        form={configForm}
                                        onChange={changeConfig}
                                        errors={configErrors}
                                        activeTab={configTab}
                                        onTabChange={setConfigTab}
                                        training={configTraining}
                                        kind={model?.kind}
                                    />
                                    <div className="d-flex justify-content-end gap-2">
                                        <Button variant="light" size="sm" className="border small" disabled={configSaving} onClick={closeDialogs}>
                                            Cancel
                                        </Button>
                                        <Button variant="primary" size="sm" className="small d-inline-flex align-items-center gap-2" type="submit" disabled={configSaving}>
                                            {configSaving && <Spinner animation="border" size="sm" />}
                                            {configTarget.instance ? "Save" : "Continue"}
                                        </Button>
                                    </div>
                                </Form>
                            )}
                        </>
                    ) : (
                        <>
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

                            {confirmAction?.config && <ConfigSummary config={confirmAction.config} />}
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

                            {confirmAction?.config && <ConfigSummary config={confirmAction.config} />}
                        </>
                    )}
                    <div className="d-flex justify-content-end gap-2">
                        {confirmAction?.type === "deploy" && configForm ? (
                            <Button variant="light" size="sm" className="border small" onClick={backToConfig}>Back</Button>
                        ) : (
                            <Button variant="light" size="sm" className="border small" onClick={closeDialogs}>Cancel</Button>
                        )}
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
                                ? "Stop"
                                : confirmAction?.type === "reset-key"
                                    ? "Reset key"
                                    : confirmAction?.type === "restart"
                                        ? "Redeploy"
                                        : confirmIsRollback
                                            ? "Roll back"
                                            : confirmIsProductionDeploy
                                                ? "Promote"
                                                : "Deploy"}
                        </Button>
                    </div>
                        </>
                    )}
                </Modal.Body>
            </Modal>
        </div>
    );
};

export default Publish;
