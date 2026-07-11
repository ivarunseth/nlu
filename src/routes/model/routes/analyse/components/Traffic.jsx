import { useContext, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import {
    ArrowClockwise,
    Broadcast,
    ExclamationTriangle,
    GraphUp,
    Lightning,
    Percent,
    Send,
    Stopwatch,
    Tags
} from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import axios from "axios";
import { UserContext } from "../../../../../contexts/UserContext";
import { CardHeading, EmptyMessage, EmptyState, SectionLabel } from "../../../../../shared/components/SectionCard";
import { entityColor, readableTextColor } from "../../../../../shared/components/entityColors";
import ChartCard from "./ChartCard";
import Strip from "./Strip";
import { BLUE, RED, TEAL, Hist, TimeLines } from "./charts";

const ENV_ORDER = ["development", "testing", "production"];
const WINDOWS = [[1, "last hour"], [6, "last 6 hours"], [24, "last 24 hours"], [168, "last 7 days"]];
const REFRESH_MS = 30000;

const rate = (part, total) => (total ? `${(part / total * 100).toFixed(1)}%` : "-");

// One live-feed row over a persisted telemetry record: the prediction (or
// error) is read out of the stored output JSON — ranked labels for
// classification, entity spans for named entity recognition.
const FeedRow = ({ record, colorOf }) => {
    const output = record.output && typeof record.output === "object" ? record.output : {};
    const labels = Array.isArray(output.labels) ? output.labels : null;
    const entities = Array.isArray(output.tags) && Array.isArray(output.entities) ? output.entities : null;
    return (
        <tr>
            <td className="px-3 text-muted font-monospace text-nowrap">
                {new Date(record.created_at * 1000).toLocaleTimeString()}
            </td>
            <td>
                <Badge bg="secondary-subtle" text="body-emphasis" className="border font-monospace fw-normal">
                    {record.environment} v{record.version ?? "?"}
                </Badge>
            </td>
            <td className="text-break">
                {record.input ?? <span className="text-muted">not captured</span>}
            </td>
            <td>
                {output.error ? (
                    <Badge bg="danger" title={output.error}>{output.type || "Error"}</Badge>
                ) : entities ? (
                    entities.length ? (
                        <span className="d-inline-flex flex-wrap gap-1">
                            {entities.map((entity, index) => {
                                const color = colorOf(entity.entity);
                                return (
                                    <Badge
                                        key={index}
                                        className="border fw-normal"
                                        bg=""
                                        style={{ backgroundColor: color, color: readableTextColor(color) }}
                                        title={entity.score != null ? `${entity.entity} · ${(entity.score * 100).toFixed(1)}%` : entity.entity}
                                    >
                                        {entity.value} · {entity.entity}
                                    </Badge>
                                );
                            })}
                        </span>
                    ) : (
                        <span className="text-muted">no entities</span>
                    )
                ) : labels && labels.length ? (
                    <span className="d-inline-flex align-items-center gap-2">
                        <Badge bg="primary-subtle" text="primary-emphasis" className="border fw-normal">
                            {labels[0].name}
                        </Badge>
                        {labels[0].score != null && (
                            <span className="text-muted font-monospace" style={{ fontSize: "0.7rem" }}>
                                {(labels[0].score * 100).toFixed(1)}%
                            </span>
                        )}
                    </span>
                ) : (
                    <span className="text-muted">—</span>
                )}
            </td>
            <td className="text-end font-monospace text-nowrap">
                {record.latency != null && `${record.latency} ms`}
                {record.cached && <Lightning className="text-warning ms-1" title="Served from cache" />}
            </td>
        </tr>
    );
};

// Live production telemetry over the persisted prediction rows: the analytics
// endpoint drains the buffered telemetry queues on every read, so polling it
// keeps the aggregates and the feed moving with the traffic.
const Traffic = ({ dataset, instances, ner }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [env, setEnv] = useState("");
    const [hours, setHours] = useState(24);
    const [data, setData] = useState(null);
    const [auto, setAuto] = useState(true);
    const [thresh, setThresh] = useState(0.5);
    const [tick, setTick] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user || !modelId) return;
        const load = async (spin) => {
            try {
                if (spin) setLoading(true);
                const response = await axios.get(`/api/models/${modelId}/analytics/live`, {
                    params: { hours, ...(env && { environment: env }) },
                    headers: { Authorization: `Bearer ${user.token}` }
                });
                setData(response.data);
                setError(null);
            } catch (err) {
                setError(err.response?.data?.error || err.message);
            } finally {
                if (spin) setLoading(false);
            }
        };
        load(true);
        if (!auto) return;
        const timer = setInterval(() => load(false), REFRESH_MS);
        return () => clearInterval(timer);
    }, [user, modelId, env, hours, tick, auto]);

    const environments = [...new Set([
        ...instances.map((instance) => instance.environment),
        ...(data?.environments || []).map(([name]) => name)
    ])].sort((a, b) => ENV_ORDER.indexOf(a) - ENV_ORDER.indexOf(b));

    // The colour assigned to each entity in Build, falling back to the
    // deterministic name-based palette for anything unknown.
    const stored = Object.fromEntries((dataset?.labels || [])
        .filter((label) => label.color)
        .map((label) => [label.name, label.color]));
    const colorOf = (name) => stored[name] || entityColor(name);

    const feed = data?.recent || [];
    const bins = (data?.confidence || []).map((bin) => ({
        ...bin,
        range: `${bin.lo.toFixed(1)}–${bin.hi.toFixed(1)}`
    }));
    const scored = bins.reduce((sum, bin) => sum + bin.n, 0);
    const below = bins.filter((bin) => bin.hi <= thresh).reduce((sum, bin) => sum + bin.n, 0);
    const scoredUnit = ner ? "spans" : "predictions";

    // Live mix share vs its dataset counterpart: predicted labels against
    // utterances per label, predicted entities against annotated spans.
    const mixTotal = ner ? data?.spans?.total : data && data.total - data.errors;
    const datasetTotal = ner ? dataset?.annotation?.spans : dataset?.totals?.utterances;
    const datasetShare = Object.fromEntries((dataset?.labels || []).map((label) => [
        label.name,
        datasetTotal ? label.count / datasetTotal : 0
    ]));

    const items = data && [
        { label: "Requests", value: data.total, icon: <Send /> },
        {
            label: "Error rate",
            value: (
                <span className={data.errors ? "text-danger fw-bold" : undefined}>
                    {rate(data.errors, data.total)}
                </span>
            ),
            icon: <ExclamationTriangle />
        },
        {
            label: "Latency p95",
            value: data.latency.p95 != null ? <span className="font-monospace">{data.latency.p95} ms</span> : "-",
            icon: <Stopwatch />
        },
        { label: "Cache hits", value: rate(data.cache_hits, data.total), icon: <Lightning /> },
        ...(ner ? [{
            label: "Spans / request",
            value: data.spans?.mean != null ? <span className="font-monospace">{data.spans.mean}</span> : "-",
            icon: <Tags />
        }] : [])
    ];

    return (
        <>
            <div className="d-flex flex-wrap align-items-center justify-content-between row-gap-2 mb-3">
                <span className="d-inline-flex align-items-center gap-2">
                    <SectionLabel>{env} traffic</SectionLabel>
                    <Badge bg={auto ? "success" : "secondary"}>{auto ? "LIVE" : "PAUSED"}</Badge>
                </span>
                <span className="d-inline-flex align-items-center gap-3">
                    <Form.Check
                        type="switch"
                        id="auto-refresh"
                        className="mb-0"
                        label={<span className="small text-muted fw-bold">Auto refresh</span>}
                        checked={auto}
                        onChange={(e) => setAuto(e.target.checked)}
                    />
                    <Form.Select size="sm" value={env} onChange={(e) => setEnv(e.target.value)} style={{ width: "auto" }} aria-label="Environment">
                        <option value="">all environments</option>
                        {environments.map((name) => <option key={name} value={name}>{name}</option>)}
                    </Form.Select>
                    <Form.Select size="sm" value={hours} onChange={(e) => setHours(parseInt(e.target.value))} style={{ width: "auto" }} aria-label="Time window">
                        {WINDOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Form.Select>
                    <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Refresh" onClick={() => setTick((t) => t + 1)} disabled={loading}>
                        <ArrowClockwise />
                    </Button>
                </span>
            </div>
            {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
            {loading || !data ? (
                <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "30vh" }}>
                    <Spinner animation="border" variant="secondary" />
                </div>
            ) : (
                <>
                    <Strip items={items} />
                    {data.total === 0 ? (
                        <Row className="g-3 mt-1">
                            <Col xs={12}>
                                <EmptyState icon={<Broadcast />}>
                                    No traffic in this window yet — queries land here once they hit the
                                    inference endpoint. Send one from Test, or use the curl snippet in Publish.
                                </EmptyState>
                            </Col>
                        </Row>
                    ) : (
                        <Row className="g-3 mt-1">
                            <Col xs={12}>
                                <ChartCard
                                    icon={<GraphUp />}
                                    title="Throughput"
                                    name="throughput"
                                    height={240}
                                    csv={() => [["time", "requests", "errors"],
                                        ...data.series.map((row) => [new Date(row.t * 1000).toISOString(), row.count, row.errors])]}
                                    foot={`requests per ${data.bucket >= 3600 ? `${Math.round(data.bucket / 3600)}h` : `${Math.round(data.bucket / 60)}min`} bucket`}
                                >
                                    <TimeLines
                                        data={data.series}
                                        lines={[{ key: "count", color: BLUE }, { key: "errors", color: RED }]}
                                    />
                                </ChartCard>
                            </Col>
                            <Col lg={4}>
                                <Card className="border-light overflow-hidden h-100">
                                    <CardHeading icon={<Stopwatch />} title="Latency" right={
                                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>server-measured</span>
                                    } />
                                    <Card.Body className="p-0">
                                        <Table size="sm" className="mb-0 small align-middle">
                                            <tbody>
                                                {[["average", data.latency.avg], ["p50", data.latency.p50],
                                                  ["p95", data.latency.p95], ["p99", data.latency.p99],
                                                  ["max", data.latency.max]].map(([name, value]) => (
                                                    <tr key={name}>
                                                        <td className="px-3 fw-bold text-muted">{name}</td>
                                                        <td className="text-end pe-3 font-monospace">
                                                            {value != null ? `${value} ms` : "-"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                        {data.errors_by_type.length > 0 && (
                                            <div className="px-3 py-2 border-top border-light-subtle">
                                                <SectionLabel>Errors by type</SectionLabel>
                                                <div className="d-flex flex-wrap gap-2 mt-2">
                                                    {data.errors_by_type.map(([type, count]) => (
                                                        <Badge key={type} bg="danger-subtle" text="danger-emphasis" className="border fw-normal">
                                                            {type} ×{count}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col lg={4}>
                                <ChartCard
                                    icon={<Percent />}
                                    title={ner ? "Span confidence" : "Confidence"}
                                    name="confidence"
                                    height={200}
                                    csv={() => [["from", "to", scoredUnit], ...bins.map((bin) => [bin.lo, bin.hi, bin.n])]}
                                    foot={
                                        <span className="d-flex align-items-center gap-2">
                                            <Form.Range
                                                min={0} max={1} step={0.1} value={thresh}
                                                onChange={(e) => setThresh(parseFloat(e.target.value))}
                                                style={{ width: "100px" }}
                                                aria-label="Low-confidence threshold"
                                            />
                                            <span>
                                                {below} of {scored} {scoredUnit} ({rate(below, scored)}) below {thresh.toFixed(1)}
                                            </span>
                                        </span>
                                    }
                                >
                                    {scored ? (
                                        <Hist bins={bins} color={TEAL} name={scoredUnit} />
                                    ) : (
                                        <EmptyMessage icon={<Percent />}>No scored {scoredUnit}.</EmptyMessage>
                                    )}
                                </ChartCard>
                            </Col>
                            <Col lg={4}>
                                <Card className="border-light overflow-hidden h-100">
                                    <CardHeading icon={<Tags />} title={ner ? "Predicted entity mix" : "Predicted label mix"} right={
                                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>vs dataset share</span>
                                    } />
                                    <Card.Body className="p-0">
                                        {data.labels.length ? (
                                            <div className="overflow-auto" style={{ maxHeight: "300px" }}>
                                                <Table hover size="sm" className="mb-0 small align-middle">
                                                    <thead className="bg-body-tertiary sticky-top">
                                                        <tr>
                                                            <th className="px-3">{ner ? "Entity" : "Label"}</th>
                                                            <th className="text-end">Live</th>
                                                            <th className="text-end pe-3">Dataset</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {data.labels.map(([label, count]) => (
                                                            <tr key={label}>
                                                                <td className="px-3">
                                                                    {ner && (
                                                                        <span
                                                                            className="d-inline-block me-2 rounded-circle"
                                                                            style={{ width: "8px", height: "8px", backgroundColor: colorOf(label) }}
                                                                        />
                                                                    )}
                                                                    {label}
                                                                </td>
                                                                <td className="text-end font-monospace">{rate(count, mixTotal)}</td>
                                                                <td className="text-end pe-3 font-monospace text-muted">
                                                                    {datasetShare[label] != null ? `${(datasetShare[label] * 100).toFixed(1)}%` : "-"}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </Table>
                                            </div>
                                        ) : (
                                            <EmptyMessage icon={<Tags />}>
                                                {ner ? "No predicted entities yet." : "No predicted labels yet."}
                                            </EmptyMessage>
                                        )}
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col xs={12}>
                                <Card className="border-light overflow-hidden">
                                    <CardHeading
                                        icon={<Broadcast />}
                                        title="Recent requests"
                                        right={
                                            <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                                                latest {feed.length} request{feed.length === 1 ? "" : "s"}
                                            </span>
                                        }
                                    />
                                    <Card.Body className="p-0">
                                        {feed.length ? (
                                            <div className="overflow-auto" style={{ maxHeight: "400px" }}>
                                                <Table hover size="sm" className="mb-0 small align-middle">
                                                    <thead className="bg-body-tertiary sticky-top">
                                                        <tr>
                                                            <th className="px-3">Time</th>
                                                            <th>Deployment</th>
                                                            <th>Query</th>
                                                            <th>Prediction</th>
                                                            <th className="text-end pe-3">Latency</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {feed.map((record, index) => (
                                                            <FeedRow key={record.id ?? index} record={record} colorOf={colorOf} />
                                                        ))}
                                                    </tbody>
                                                </Table>
                                            </div>
                                        ) : (
                                            <EmptyMessage icon={<Broadcast />}>
                                                No requests captured in this window.
                                            </EmptyMessage>
                                        )}
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}
                </>
            )}
        </>
    );
};

export default Traffic;
