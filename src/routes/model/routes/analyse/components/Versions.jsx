import { useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { GraphUp, Grid3x3Gap, PlusSlashMinus, Shuffle, Trophy } from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
import { CardHeading, EmptyMessage, EmptyState, SectionLabel } from "../../../../../shared/components/SectionCard";
import { pct } from "../../../../../shared/utils/training";
import ChartCard from "./ChartCard";
import { COLORS, GapBars, TrendLines } from "./charts";

const GAP_LIMIT = 0.1;

const METRICS = [
    { key: "test accuracy", color: COLORS[0], get: (v) => v.accuracy },
    { key: "train accuracy", color: COLORS[1], get: (v) => v.train_accuracy },
    { key: "macro precision", color: COLORS[3], get: (v) => v.macro?.precision },
    { key: "macro recall", color: COLORS[5], get: (v) => v.macro?.recall },
    { key: "macro F1", color: COLORS[4], get: (v) => v.macro?.f1 },
    { key: "weighted F1", color: COLORS[6], get: (v) => v.weighted?.f1 }
];

// The slot half of a language understanding version. These score whole
// annotations — a slot counts only when its name and both boundaries match — so
// they need no qualifier: the token view is the one that has to say so.
const NLU_METRICS = [
    { key: "slot F1", color: COLORS[2], get: (v) => v.slots?.f1 },
    { key: "slot precision", color: COLORS[7], get: (v) => v.slots?.precision },
    // The palette's eight colours are all taken; Tableau brown matches it.
    { key: "slot recall", color: "#9C755F", get: (v) => v.slots?.recall }
];

// Cross-version model quality: trends, overfit gap, per-label F1 movement,
// persistent confusions and the best-version recommendation. For named
// entity recognition the stored report is token-level over IOB tags:
// accuracy reads as token accuracy, per-entity F1 collapses the B-/I- tag
// scores, and the confusions are tag pairs. For language understanding the
// headline metrics are the intent metrics and the slot half adds exact-match
// slot F1 trends plus a per-slot table.
const Versions = ({ versions, best, confusions, win, setWin, ner, nlu }) => {
    const { modelId } = useParams();
    const [selected, setSelected] = useState(nlu
        ? ["test accuracy", "macro F1", "slot F1"]
        : ["test accuracy", "macro F1"]);

    if (!versions.length) {
        return (
            <EmptyState icon={<GraphUp />}>
                No successful training yet — start one in <Link to={`/models/${modelId}/history`}>History</Link>.
            </EmptyState>
        );
    }

    const metrics = nlu ? [...METRICS, ...NLU_METRICS] : METRICS;
    const sliced = win > 0 ? versions.slice(-win) : versions;
    const data = sliced.map((version) => Object.fromEntries([
        ["version", version.version],
        ...metrics.map((metric) => [metric.key, metric.get(version)])
    ]));
    const gaps = sliced.filter((version) => version.gap != null)
        .map((version) => ({ version: version.version, gap: version.gap }));
    const names = [...new Set(sliced.flatMap((version) => Object.keys(version.labels || {})))].sort();
    const slotNames = nlu
        ? [...new Set(sliced.flatMap((version) => Object.keys(version.slots?.labels || {})))].sort()
        : [];

    const toggle = (key) => {
        setSelected((prev) => prev.includes(key)
            ? (prev.length > 1 ? prev.filter((item) => item !== key) : prev)
            : [...prev, key]);
    };

    const bar = (
        <div className="d-flex flex-wrap align-items-center column-gap-3 row-gap-2 px-3 py-2 bg-body-tertiary border-bottom border-light-subtle">
            {metrics.map((metric) => (
                <Form.Check
                    key={metric.key}
                    type="checkbox"
                    id={`trend-${metric.key.replace(/\s/g, "-")}`}
                    className="mb-0"
                    label={
                        <span className="d-inline-flex align-items-center gap-1 small">
                            <span
                                style={{
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "50%",
                                    backgroundColor: metric.color,
                                    display: "inline-block",
                                    flexShrink: 0
                                }}
                            />
                            {metric.key}
                        </span>
                    }
                    checked={selected.includes(metric.key)}
                    onChange={() => toggle(metric.key)}
                />
            ))}
        </div>
    );

    return (
        <>
            <div className="d-flex align-items-center justify-content-between mb-3">
                <SectionLabel>Cross-version quality</SectionLabel>
                <Form.Select
                    size="sm"
                    value={win}
                    onChange={(e) => setWin(parseInt(e.target.value))}
                    style={{ width: "auto" }}
                    aria-label="Version window"
                >
                    <option value={3}>last 3 versions</option>
                    <option value={5}>last 5 versions</option>
                    <option value={10}>last 10 versions</option>
                    <option value={0}>all versions</option>
                </Form.Select>
            </div>
            <Row className="g-3">
                {best && (
                    <Col xs={12}>
                        <Card className="border-light">
                            <Card.Body className="p-3 d-flex flex-wrap align-items-center gap-3">
                                <div className="text-primary fs-3 lh-1"><Trophy /></div>
                                <div>
                                    <div
                                        className="text-muted small fw-bold"
                                        style={{ fontSize: "var(--app-text-xs)" }}
                                        title="Ranked by test accuracy, tie-broken by macro F1"
                                    >
                                        RECOMMENDED VERSION
                                    </div>
                                    <div className="small">
                                        <span className="font-monospace fw-bold">v{best.version}</span>
                                        {" — "}{pct(best.accuracy)} test accuracy
                                        {best.f1 != null && <> · {best.f1.toFixed(3)} macro F1</>}
                                    </div>
                                </div>
                                <div className="ms-auto d-flex gap-2">
                                    <Button as={Link} to={`/models/${modelId}/history/${best.id}`} variant="light" size="sm" className="border small">
                                        INSPECT
                                    </Button>
                                    <Button as={Link} to={`/models/${modelId}/publish`} variant="primary" size="sm" className="small">
                                        PROMOTE
                                    </Button>
                                </div>
                            </Card.Body>
                        </Card>
                    </Col>
                )}
                <Col lg={8}>
                    <ChartCard
                        icon={<GraphUp />}
                        title="Metric trends"
                        name="metric_trends"
                        height={300}
                        bar={bar}
                        csv={() => [
                            ["version", ...selected],
                            ...data.map((row) => [row.version, ...selected.map((key) => row[key] ?? "")])
                        ]}
                        foot={ner
                            ? "token metrics over IOB tags — a partly matched entity still scores its matched tokens"
                            : nlu && "accuracy and macro/weighted metrics score the intent; the slot metrics count a slot only when its name and both boundaries match"}
                    >
                        <TrendLines
                            data={data}
                            lines={metrics.filter((metric) => selected.includes(metric.key))}
                        />
                    </ChartCard>
                </Col>
                <Col lg={4}>
                    <ChartCard
                        icon={<PlusSlashMinus />}
                        title="Overfit gap"
                        name="overfit_gap"
                        height={300}
                        csv={() => [["version", "gap"], ...gaps.map((row) => [row.version, row.gap])]}
                        foot={`train − test accuracy per version · red bars exceed ${GAP_LIMIT}`}
                    >
                        {gaps.length ? (
                            <GapBars data={gaps} limit={GAP_LIMIT} />
                        ) : (
                            <EmptyMessage icon={<PlusSlashMinus />}>No train/test accuracy pairs available.</EmptyMessage>
                        )}
                    </ChartCard>
                </Col>
                <Col lg={7}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<Grid3x3Gap />}
                            title={ner ? "Per-entity F1" : nlu ? "Per-intent F1" : "Per-label F1"}
                            right={
                                <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                                    {ner ? "B-/I- tag scores merged per entity · test split" : "test split, by version"}
                                </span>
                            }
                        />
                        <Card.Body className="p-0">
                            {names.length ? (
                                <div className="overflow-auto" style={{ maxHeight: "400px" }}>
                                    <Table size="sm" className="mb-0 text-center align-middle font-monospace small">
                                        <thead className="bg-body-tertiary sticky-top">
                                            <tr>
                                                <th className="text-start px-3">{ner ? "Entity" : nlu ? "Intent" : "Label"}</th>
                                                {sliced.map((version) => (
                                                    <th key={version.id}>v{version.version}</th>
                                                ))}
                                                <th title="Change from the first to the last version in the window">Δ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {names.map((name) => {
                                                const series = sliced.map((version) => version.labels?.[name]);
                                                const known = series.filter((f1) => f1 != null);
                                                const delta = known.length > 1 ? known[known.length - 1] - known[0] : null;
                                                return (
                                                    <tr key={name}>
                                                        <td className="text-start px-3 fw-bold text-muted">{name}</td>
                                                        {series.map((f1, index) => (
                                                            <td
                                                                key={sliced[index].id}
                                                                title={f1 != null ? `${name} · v${sliced[index].version} · F1 ${f1.toFixed(4)}` : undefined}
                                                                style={f1 != null ? {
                                                                    backgroundColor: `rgba(13, 110, 253, ${0.08 + f1 * 0.72})`,
                                                                    color: f1 > 0.6 ? "#fff" : "var(--bs-body-color)"
                                                                } : undefined}
                                                            >
                                                                {f1 != null ? f1.toFixed(2) : "–"}
                                                            </td>
                                                        ))}
                                                        <td className={delta == null ? "text-muted" : delta >= 0 ? "text-success" : "text-danger"}>
                                                            {delta == null ? "–" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </Table>
                                </div>
                            ) : (
                                <EmptyMessage icon={<Grid3x3Gap />}>No per-label reports available.</EmptyMessage>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={5}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<Shuffle />}
                            title={ner ? "Persistent tag confusions" : "Persistent confusions"}
                            right={
                                <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                                    across {confusions?.window ?? 0} version{confusions?.window === 1 ? "" : "s"}
                                </span>
                            }
                        />
                        <Card.Body className="p-0">
                            {confusions?.pairs?.length ? (
                                <div className="overflow-auto" style={{ maxHeight: "400px" }}>
                                    <Table hover size="sm" className="mb-0 small align-middle">
                                        <thead className="bg-body-tertiary sticky-top">
                                            <tr>
                                                <th className="px-3">Actual</th>
                                                <th>Predicted as</th>
                                                <th className="text-end">Count</th>
                                                <th className="text-end pe-3">Versions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {confusions.pairs.map((pair) => (
                                                <tr key={`${pair.actual}→${pair.predicted}`}>
                                                    <td className="px-3">{pair.actual}</td>
                                                    <td>{pair.predicted}</td>
                                                    <td className="text-end font-monospace">{pair.count}</td>
                                                    <td className="text-end pe-3 font-monospace">{pair.versions}/{confusions.window}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            ) : (
                                <EmptyMessage icon={<Shuffle />}>No recurring confusions in this window.</EmptyMessage>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                {nlu && (
                    <Col xs={12}>
                        <Card className="border-light overflow-hidden">
                            <CardHeading
                                icon={<Grid3x3Gap />}
                                title="Per-slot F1"
                                right={
                                    <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                                        name and both boundaries must match · test split
                                    </span>
                                }
                            />
                            <Card.Body className="p-0">
                                {slotNames.length ? (
                                    <div className="overflow-auto" style={{ maxHeight: "400px" }}>
                                        <Table size="sm" className="mb-0 text-center align-middle font-monospace small">
                                            <thead className="bg-body-tertiary sticky-top">
                                                <tr>
                                                    <th className="text-start px-3">Slot</th>
                                                    {sliced.map((version) => (
                                                        <th key={version.id}>v{version.version}</th>
                                                    ))}
                                                    <th title="Change from the first to the last version in the window">Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {slotNames.map((name) => {
                                                    const series = sliced.map((version) => version.slots?.labels?.[name]);
                                                    const known = series.filter((f1) => f1 != null);
                                                    const delta = known.length > 1 ? known[known.length - 1] - known[0] : null;
                                                    return (
                                                        <tr key={name}>
                                                            <td className="text-start px-3 fw-bold text-muted">{name}</td>
                                                            {series.map((f1, index) => (
                                                                <td
                                                                    key={sliced[index].id}
                                                                    title={f1 != null ? `${name} · v${sliced[index].version} · F1 ${f1.toFixed(4)}` : undefined}
                                                                    style={f1 != null ? {
                                                                        backgroundColor: `rgba(13, 110, 253, ${0.08 + f1 * 0.72})`,
                                                                        color: f1 > 0.6 ? "#fff" : "var(--bs-body-color)"
                                                                    } : undefined}
                                                                >
                                                                    {f1 != null ? f1.toFixed(2) : "–"}
                                                                </td>
                                                            ))}
                                                            <td className={delta == null ? "text-muted" : delta >= 0 ? "text-success" : "text-danger"}>
                                                                {delta == null ? "–" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </Table>
                                    </div>
                                ) : (
                                    <EmptyMessage icon={<Grid3x3Gap />}>No per-slot entity scores available.</EmptyMessage>
                                )}
                            </Card.Body>
                        </Card>
                    </Col>
                )}
            </Row>
        </>
    );
};

export default Versions;
