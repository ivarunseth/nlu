import { useContext, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Tab, Tabs } from "react-bootstrap";
import {
    Clipboard,
    ClipboardCheck,
    ExclamationTriangle,
    InfoCircle,
    Lightning,
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
    Stop
} from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import axios from "axios";

const ENVIRONMENT = "development";

// Parse the "dd/mm/yyyy - HH:MM:SS" local-time strings the API returns into a Date.
const parseApiDate = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const [, day, month, year, hour, minute, second] = match;
    return new Date(+year, +month - 1, +day, +hour, +minute, +second);
};

const EmptyState = ({ icon, children }) => (
    <div
        className="d-flex align-items-center justify-content-center text-muted"
        style={{ minHeight: "260px", border: "1px solid #dee2e6", borderRadius: "4px", background: "#fff" }}
    >
        <div className="text-center px-3">
            <div className="fs-3 mb-2 opacity-50">{icon || <InfoCircle />}</div>
            <p className="mb-0 small fw-bold">{children}</p>
        </div>
    </div>
);

const SectionLabel = ({ children }) => (
    <span className="small fw-bold text-muted text-uppercase" style={{ fontSize: "0.65rem", letterSpacing: "0.04em" }}>
        {children}
    </span>
);

const TabTitle = ({ icon, children }) => (
    <span className="d-inline-flex align-items-center gap-2">
        {icon}
        {children}
    </span>
);

// Compact dashboard-style strip mirroring the History detail view.
const MetricStrip = ({ environment, deployedVersion, versionCount, latency }) => {
    const items = [
        { label: "Environment", value: <span className="font-monospace text-lowercase">{environment}</span>, icon: <Hdd /> },
        {
            label: "Deployed version",
            value: deployedVersion != null
                ? (
                    <span className="d-flex align-items-center justify-content-between">
                        <span className="font-monospace">v{deployedVersion}</span>
                        <span className="d-inline-flex align-items-center gap-2">
                            <StatusDot color="var(--bs-success)" />
                            <span className="text-success fw-medium">live</span>
                        </span>
                    </span>
                )
                : <span className="text-muted">none</span>,
            icon: <Cpu />
        },
        { label: "Trained versions", value: versionCount, icon: <Folder /> },
        {
            label: "Last latency",
            value: latency != null ? <span className="font-monospace">{latency} ms</span> : "-",
            icon: <Stopwatch />
        }
    ];

    return (
        <Row className="g-3">
            {items.map((item, index) => (
                <Col key={index} xs={6} lg={3}>
                    <Card className="h-100">
                        <Card.Body className="p-3 d-flex align-items-center">
                            <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                            <div className="flex-grow-1">
                                <div className="text-muted small fw-bold" style={{ fontSize: "0.65rem" }}>{item.label}</div>
                                <div className="text-dark small fw-medium">{item.value ?? "-"}</div>
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

const CardHeading = ({ icon, title, right }) => (
    <div className="d-flex align-items-center justify-content-between px-3 py-2 bg-light border-bottom border-light-subtle">
        <span className="d-inline-flex align-items-center gap-2 text-dark">
            <span className="text-primary lh-1">{icon}</span>
            <SectionLabel>{title}</SectionLabel>
        </span>
        {right}
    </div>
);

const ScoreBar = ({ score }) => {
    const percent = Math.max(0, Math.min(100, (score || 0) * 100));
    return (
        <div className="d-flex align-items-center gap-3">
            <div className="flex-grow-1 bg-light rounded-pill" style={{ height: "10px", overflow: "hidden" }}>
                <div
                    className="bg-primary h-100 rounded-pill"
                    style={{ width: `${percent}%`, transition: "width 0.4s ease" }}
                />
            </div>
            <span className="font-monospace fw-bold text-dark" style={{ minWidth: "64px", textAlign: "right" }}>
                {percent.toFixed(2)}%
            </span>
        </div>
    );
};

const TokenTags = ({ query, tags }) => {
    const tokens = (query || "").trim().split(/\s+/).filter(Boolean);
    const aligned = tokens.length === tags.length;
    const items = aligned ? tokens.map((token, index) => ({ token, tag: tags[index] })) : tags.map((tag) => ({ token: null, tag }));
    return (
        <div className="d-flex flex-wrap gap-2">
            {items.map((item, index) => (
                <div key={index} className="border border-light-subtle rounded text-center bg-white" style={{ minWidth: "60px" }}>
                    {item.token !== null && (
                        <div className="px-2 py-1 border-bottom border-light-subtle small fw-medium text-break">{item.token}</div>
                    )}
                    <div className="px-2 py-1">
                        <Badge bg={item.tag && item.tag !== "O" ? "primary" : "light"} text={item.tag && item.tag !== "O" ? undefined : "muted"} className="font-monospace fw-normal">
                            {item.tag}
                        </Badge>
                    </div>
                </div>
            ))}
        </div>
    );
};

const PredictionView = ({ prediction, query }) => {
    if (prediction == null) {
        return <EmptyState icon={<Lightning />}>Run a query to see the prediction.</EmptyState>;
    }

    if (typeof prediction === "object" && !Array.isArray(prediction) && prediction.error) {
        return (
            <Alert variant="danger" className="mb-0 d-flex align-items-start gap-2">
                <ExclamationTriangle className="mt-1 flex-shrink-0" />
                <div>
                    <div className="fw-bold small">{prediction.type || "Prediction failed"}</div>
                    <div className="small">{prediction.error}</div>
                </div>
            </Alert>
        );
    }

    // Text classification: { labels: [{ name, score }, ...] } ranked by score.
    if (typeof prediction === "object" && !Array.isArray(prediction) && Array.isArray(prediction.labels)) {
        return (
            <div>
                <SectionLabel>{prediction.labels.length > 1 ? "Predicted labels" : "Predicted label"}</SectionLabel>
                <div className="mt-3 d-flex flex-column gap-3">
                    {prediction.labels.map((item, index) => (
                        <div key={index}>
                            <div className="d-flex align-items-center gap-2 mb-2">
                                <Badge bg={index === 0 ? "primary" : "light"} text={index === 0 ? undefined : "dark"} className="fw-medium px-3 py-2 border">
                                    {item.name}
                                </Badge>
                            </div>
                            <ScoreBar score={item.score} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Natural language understanding: { intent, slots: [...] }
    if (typeof prediction === "object" && !Array.isArray(prediction) && "intent" in prediction) {
        return (
            <div>
                <div className="mb-4">
                    <SectionLabel>Intent</SectionLabel>
                    <div className="mt-2">
                        <Badge bg="primary" className="fs-6 fw-medium px-3 py-2">{prediction.intent}</Badge>
                    </div>
                </div>
                {Array.isArray(prediction.slots) && (
                    <div>
                        <SectionLabel>Slots</SectionLabel>
                        <div className="mt-2">
                            <TokenTags query={query} tags={prediction.slots} />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Named entity recognition: [tag, tag, ...]
    if (Array.isArray(prediction)) {
        return (
            <div>
                <SectionLabel>Entities</SectionLabel>
                <div className="mt-2">
                    <TokenTags query={query} tags={prediction} />
                </div>
            </div>
        );
    }

    return <pre className="p-3 mb-0 bg-light border-0 rounded small">{JSON.stringify(prediction, null, 2)}</pre>;
};

// Classic JSON syntax-highlight palette (keys / strings / numbers / booleans / null).
const JSON_COLORS = {
    key: "#d63384",
    string: "#198754",
    number: "#fd7e14",
    boolean: "#0d6efd",
    null: "#6c757d"
};

const highlightJson = (json) => json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
        (match) => {
            let type = "number";
            if (/^"/.test(match)) {
                type = /:$/.test(match) ? "key" : "string";
            } else if (/true|false/.test(match)) {
                type = "boolean";
            } else if (/null/.test(match)) {
                type = "null";
            }
            return `<span style="color:${JSON_COLORS[type]}">${match}</span>`;
        }
    );

const JsonView = ({ data }) => {
    const [copied, setCopied] = useState(false);
    const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
    const html = useMemo(() => highlightJson(json), [json]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="position-relative">
            <Button
                variant="light"
                size="sm"
                className="border position-absolute end-0 top-0 m-2 d-inline-flex align-items-center gap-1"
                onClick={handleCopy}
            >
                {copied ? <ClipboardCheck className="text-success" /> : <Clipboard />}
                <span className="small">{copied ? "Copied" : "Copy"}</span>
            </Button>
            <pre
                className="p-3 mb-0 bg-light border-0 rounded small overflow-auto"
                style={{ maxHeight: "calc(100vh - 460px)", minHeight: "260px" }}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
};

const Test = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [trainings, setTrainings] = useState([]);
    const [selectedTrainingId, setSelectedTrainingId] = useState("");
    const [deployedTrainingId, setDeployedTrainingId] = useState(null);
    const [deployedAt, setDeployedAt] = useState(null);
    const [deploying, setDeploying] = useState(false);
    const [stopping, setStopping] = useState(false);

    const [query, setQuery] = useState("");
    const [top, setTop] = useState(1);
    const [labelCount, setLabelCount] = useState(0);
    const [result, setResult] = useState(null);
    const [latency, setLatency] = useState(null);
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sendError, setSendError] = useState(false);

    const versionOf = useMemo(() => {
        const map = {};
        trainings.forEach((training) => { map[String(training.id)] = training.version; });
        return map;
    }, [trainings]);

    const deployedVersion = deployedTrainingId != null ? versionOf[String(deployedTrainingId)] : null;
    const isDeployed = deployedTrainingId != null;
    const busy = deploying || stopping;
    // Whether the version chosen in the dropdown is the one currently serving.
    const selectedIsDeployed = isDeployed && String(deployedTrainingId) === String(selectedTrainingId);

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
        if (!user || !modelId) return;
        const headers = { Authorization: `Bearer ${user.token}` };

        const load = async () => {
            try {
                const [trainingsResponse, instancesResponse, labelsResponse] = await Promise.all([
                    axios.get(`/api/models/${modelId}/trainings`, { params: { per_page: 100 }, headers }),
                    axios.get(`/api/models/${modelId}/instances`, { headers }),
                    axios.get(`/api/models/${modelId}/labels`, { params: { per_page: 1 }, headers })
                ]);

                const successful = (trainingsResponse.data.trainings || [])
                    .filter((training) => training.status === "SUCCESS")
                    .sort((a, b) => b.version - a.version);
                setTrainings(successful);

                setLabelCount(labelsResponse.data.total || 0);

                const deployed = (instancesResponse.data.instances || [])
                    .find((instance) => instance.environment === ENVIRONMENT);
                if (deployed) {
                    setDeployedTrainingId(deployed.training_id);
                    setDeployedAt(deployed.date_receive);
                    setSelectedTrainingId(String(deployed.training_id));
                }
            } catch (error) {
                setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
            }
        };
        load();
    }, [user, modelId]);

    const handleVersionChange = (event) => {
        setSelectedTrainingId(event.target.value);
        setAlert(null);
    };

    // Deploy (or redeploy) the version currently selected in the dropdown.
    const handleDeploy = async () => {
        if (!selectedTrainingId || busy) return;
        setDeploying(true);
        setAlert(null);
        try {
            const response = await axios.post(
                `/api/models/${modelId}/instances`,
                { [ENVIRONMENT]: true },
                { params: { training_id: selectedTrainingId }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            const deployed = (response.data.instances || []).find((instance) => instance.environment === ENVIRONMENT);
            setDeployedTrainingId(deployed ? deployed.training_id : selectedTrainingId);
            setDeployedAt(deployed ? deployed.date_receive : null);
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
            setDeployedTrainingId(null);
            setDeployedAt(null);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setStopping(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!query.trim() || loading || !isDeployed) return;

        setLoading(true);
        setAlert(null);
        setSendError(false);
        const startedAt = performance.now();
        try {
            const response = await axios.post(
                `/triton/models/${modelId}/infer`,
                { query },
                { params: { top }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setResult({ query, prediction: response.data, version: deployedVersion });
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
                versionCount={trainings.length}
                latency={latency}
            />

            <Row className="g-4 mt-1">
                <Col lg={5}>
                    <Card className="border-light h-100 overflow-hidden">
                        <CardHeading
                            icon={<Send />}
                            title="Request"
                        />
                        <Card.Body className="p-3 d-flex flex-column">
                            {trainings.length === 0 ? (
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
                                                className="border d-inline-flex align-items-center flex-shrink-0"
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
                                                title="Reload deployed version"
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

                                    <Form onSubmit={handleSubmit} className="d-flex flex-column flex-grow-1">
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
                                                    <span className="font-monospace small text-dark">{top} / {labelCount}</span>
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
                                        <div className="d-flex align-items-center justify-content-between">
                                            <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: "0.7rem" }}>
                                                <kbd className="bg-light text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>⌘/Ctrl</kbd>
                                                +
                                                <kbd className="bg-light text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>Enter</kbd>
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
                                </>
                            )}
                        </Card.Body>
                    </Card>
                </Col>

                <Col lg={7}>
                    <Card className="border-light h-100 overflow-hidden">
                        <CardHeading
                            icon={<Reply />}
                            title="Response"
                        />
                        <Card.Body className="p-3">
                            <Tabs defaultActiveKey="result" className="border-bottom border-light-subtle custom-tabs mb-3">
                                <Tab eventKey="result" title={<TabTitle icon={<CardText />}>Result</TabTitle>}>
                                    <div className="pt-3 pe-3 overflow-auto" style={{ maxHeight: "calc(100vh - 460px)", minHeight: "260px" }}>
                                        <PredictionView prediction={result?.prediction} query={result?.query} />
                                    </div>
                                </Tab>
                                <Tab eventKey="json" title={<TabTitle icon={<Braces />}>JSON</TabTitle>}>
                                    <div className="pt-3">
                                        {result ? (
                                            <JsonView data={result.prediction} />
                                        ) : (
                                            <EmptyState icon={<Braces />}>The raw response will appear here.</EmptyState>
                                        )}
                                    </div>
                                </Tab>
                            </Tabs>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default Test;
