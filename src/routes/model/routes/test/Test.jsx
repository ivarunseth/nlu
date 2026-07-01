import { useContext, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Tab, Tabs } from "react-bootstrap";
import {
    Clipboard,
    ClipboardCheck,
    ExclamationTriangle,
    InfoCircle,
    Lightning,
    PlayFill,
    Braces,
    CardText,
    RocketTakeoff,
    Hdd,
    Stack,
    Stopwatch,
    Send,
    Reply,
    FolderCheck,
    Folder
} from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import axios from "axios";

const ENVIRONMENT = "development";

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
                ? <span className="font-monospace">v{deployedVersion}</span>
                : <span className="text-muted">none</span>,
            icon: <RocketTakeoff />
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
                    <Card className="border-light h-100">
                        <Card.Body className="p-3 d-flex align-items-center">
                            <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                            <div>
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

    // Text classification: { label, score }
    if (typeof prediction === "object" && !Array.isArray(prediction) && "label" in prediction) {
        return (
            <div>
                <div className="mb-4">
                    <SectionLabel>Predicted label</SectionLabel>
                    <div className="d-flex align-items-center gap-2 mt-2">
                        <Badge bg="primary" className="fs-6 fw-medium px-3 py-2">{prediction.label}</Badge>
                    </div>
                </div>
                {"score" in prediction && (
                    <div>
                        <SectionLabel>Confidence</SectionLabel>
                        <div className="mt-2">
                            <ScoreBar score={prediction.score} />
                        </div>
                    </div>
                )}
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

const JsonView = ({ data }) => {
    const [copied, setCopied] = useState(false);
    const json = useMemo(() => JSON.stringify(data, null, 2), [data]);

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
            <pre className="p-3 mb-0 bg-light border-0 rounded small overflow-auto" style={{ maxHeight: "calc(100vh - 460px)", minHeight: "260px" }}>
                {json}
            </pre>
        </div>
    );
};

const Test = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [trainings, setTrainings] = useState([]);
    const [selectedTrainingId, setSelectedTrainingId] = useState("");
    const [deployedTrainingId, setDeployedTrainingId] = useState(null);
    const [deploying, setDeploying] = useState(false);

    const [query, setQuery] = useState("");
    const [result, setResult] = useState(null);
    const [latency, setLatency] = useState(null);
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(false);

    const versionOf = useMemo(() => {
        const map = {};
        trainings.forEach((training) => { map[String(training.id)] = training.version; });
        return map;
    }, [trainings]);

    const deployedVersion = deployedTrainingId != null ? versionOf[String(deployedTrainingId)] : null;
    const isDeployed = deployedTrainingId != null;

    // Load the model's trained versions and whatever is currently in development.
    useEffect(() => {
        if (!user || !modelId) return;
        const headers = { Authorization: `Bearer ${user.token}` };

        const load = async () => {
            try {
                const [trainingsResponse, instancesResponse] = await Promise.all([
                    axios.get(`/api/models/${modelId}/trainings`, { params: { per_page: 100 }, headers }),
                    axios.get(`/api/models/${modelId}/instances`, { headers })
                ]);

                const successful = (trainingsResponse.data.trainings || [])
                    .filter((training) => training.status === "SUCCESS")
                    .sort((a, b) => b.version - a.version);
                setTrainings(successful);

                const deployed = (instancesResponse.data.instances || [])
                    .find((instance) => instance.environment === ENVIRONMENT);
                if (deployed) {
                    setDeployedTrainingId(deployed.training_id);
                    setSelectedTrainingId(String(deployed.training_id));
                }
            } catch (error) {
                setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
            }
        };
        load();
    }, [user, modelId]);

    const handleVersionChange = async (event) => {
        const trainingId = event.target.value;
        setSelectedTrainingId(trainingId);
        if (!trainingId) return;

        setDeploying(true);
        setAlert(null);
        try {
            await axios.post(
                `/api/models/${modelId}/instances`,
                { [ENVIRONMENT]: true },
                { params: { training_id: trainingId }, headers: { Authorization: `Bearer ${user.token}` } }
            );
            setDeployedTrainingId(trainingId);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
            setSelectedTrainingId(deployedTrainingId != null ? String(deployedTrainingId) : "");
        } finally {
            setDeploying(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!query.trim() || loading || !isDeployed) return;

        setLoading(true);
        setAlert(null);
        const startedAt = performance.now();
        try {
            const response = await axios.post(
                `/triton/models/${modelId}/infer`,
                { query },
                { headers: { Authorization: `Bearer ${user.token}` } }
            );
            setResult({ query, prediction: response.data, version: deployedVersion });
            setLatency(Math.round(performance.now() - startedAt));
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            if (status === 404) {
                setAlert({
                    variant: "warning",
                    message: "The selected version isn't serving yet. Re-select it to redeploy, then try again."
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
                            right={isDeployed ? (
                                <span className="d-inline-flex align-items-center gap-2 small fw-medium text-success">
                                    <StatusDot color="var(--bs-success)" />
                                    <span className="font-monospace">v{deployedVersion}</span> live
                                </span>
                            ) : (
                                <Badge bg="secondary" className="fw-normal">none deployed</Badge>
                            )}
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
                                        <Form.Select
                                            value={selectedTrainingId}
                                            onChange={handleVersionChange}
                                            disabled={deploying}
                                            size="sm"
                                        >
                                            <option value="">Select a version to deploy…</option>
                                            {trainings.map((training) => (
                                                <option key={training.id} value={training.id}>
                                                    v{training.version}
                                                </option>
                                            ))}
                                        </Form.Select>
                                        <div className="text-muted d-flex align-items-center gap-1 mt-1" style={{ fontSize: "0.7rem", minHeight: "16px" }}>
                                            {deploying ? (
                                                <><Spinner animation="border" size="sm" />&nbsp;Deploying to {ENVIRONMENT}…</>
                                            ) : (
                                                <span>Selecting a version deploys it to {ENVIRONMENT}.</span>
                                            )}
                                        </div>
                                    </Form.Group>

                                    <Form onSubmit={handleSubmit} className="d-flex flex-column flex-grow-1">
                                        <Form.Label className="mb-1"><SectionLabel>Input</SectionLabel></Form.Label>
                                        <Form.Control
                                            as="textarea"
                                            rows={6}
                                            value={query}
                                            placeholder={isDeployed ? "Type a sentence to send to the model…" : "Deploy a version first to start testing."}
                                            onChange={(event) => setQuery(event.target.value)}
                                            onKeyDown={(event) => {
                                                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                    handleSubmit(event);
                                                }
                                            }}
                                            className="mb-3 flex-grow-1"
                                            disabled={loading || deploying || !isDeployed}
                                        />
                                        <div className="d-flex align-items-center justify-content-between">
                                            <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: "0.7rem" }}>
                                                <kbd className="bg-light text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>⌘/Ctrl</kbd>
                                                +
                                                <kbd className="bg-light text-muted border px-1 py-0" style={{ fontSize: "0.65rem" }}>Enter</kbd>
                                                to run
                                            </span>
                                            <Button type="submit" variant="primary" size="sm" disabled={loading || deploying || !isDeployed || !query.trim()} className="d-inline-flex align-items-center gap-1 px-3">
                                                {loading ? (
                                                    <><Spinner animation="border" size="sm" />&nbsp;Running…</>
                                                ) : (
                                                    <><PlayFill />&nbsp;Run</>
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
                            right={
                                <span className="d-inline-flex align-items-center gap-2">
                                    {latency != null && result && (
                                        <Badge bg="light" text="muted" className="border fw-normal font-monospace d-inline-flex align-items-center gap-1">
                                            <Stopwatch size={10} /> {latency} ms
                                        </Badge>
                                    )}
                                    {result?.version != null && (
                                        <Badge bg="light" text="dark" className="border fw-normal font-monospace">v{result.version}</Badge>
                                    )}
                                </span>
                            }
                        />
                        <Card.Body className="p-3">
                            <Tabs defaultActiveKey="result" className="border-bottom border-light-subtle custom-tabs mb-3">
                                <Tab eventKey="result" title={<TabTitle icon={<CardText />}>Result</TabTitle>}>
                                    <div className="pt-3">
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
