import { Badge, Button, Card, Col, ListGroup, Row } from "react-bootstrap";
import {
    Check2Circle,
    Database,
    ExclamationTriangle,
    GraphUp,
    Hdd,
    InfoCircle,
    Collection,
    Trophy
} from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";
import { parseApiDate, pct } from "../../../../../shared/utils/training";
import Strip from "./Strip";
import { BLUE, LabelBars, TrendLines } from "./charts";

const ENV_ORDER = ["development", "testing", "production"];

// Thresholds behind the "needs attention" warnings.
const RATIO_LIMIT = 10;
const MIN_EXAMPLES = 5;
const WEAK_F1 = 0.6;
const GAP_LIMIT = 0.15;

// The glanceable health summary: metric strip, plain-language one-liner,
// warnings, and the headline card of each tab with a deep link into it.
const Overview = ({ dataset, versions, best, instances, ner, goto }) => {
    const { modelId } = useParams();

    const totals = dataset?.totals || { utterances: 0, labels: 0, empty: 0 };
    const imbalance = dataset?.imbalance;
    const annotation = dataset?.annotation;
    const thing = ner ? "entity" : "label";
    const things = ner ? "entities" : "labels";
    const latest = versions[versions.length - 1];
    const byId = Object.fromEntries(versions.map((version) => [version.id, version]));

    const deployed = instances
        .map((instance) => {
            const training = byId[instance.training_id];
            const trained = parseApiDate(training?.date_done);
            const received = parseApiDate(instance.date_receive);
            return {
                environment: instance.environment,
                version: training?.version,
                stale: trained != null && received != null && trained.getTime() > received.getTime()
            };
        })
        .sort((a, b) => ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment));

    const weakest = latest
        ? Object.entries(latest.labels || {})
            .filter(([, f1]) => f1 != null)
            .sort((a, b) => a[1] - b[1])[0]
        : null;

    const items = [
        {
            label: "Dataset",
            value: `${totals.utterances} utterances · ${totals.labels} ${things}`,
            icon: <Database />
        },
        { label: "Trained versions", value: `${versions.length} succeeded`, icon: <Collection /> },
        {
            label: ner ? "Best token accuracy" : "Best accuracy",
            value: best ? (
                <span>
                    <span className="fw-bold">{pct(best.accuracy)}</span>
                    {" "}
                    <span className="font-monospace text-muted">v{best.version}</span>
                </span>
            ) : "-",
            icon: <Trophy />
        },
        {
            label: "Deployed",
            value: deployed.length ? (
                <span className="d-inline-flex flex-wrap gap-1">
                    {deployed.map((entry) => (
                        <Badge
                            key={entry.environment}
                            bg="secondary-subtle"
                            text="body-emphasis"
                            className="border font-monospace fw-normal"
                        >
                            {entry.environment} v{entry.version ?? "?"}
                        </Badge>
                    ))}
                </span>
            ) : <span className="text-muted">none</span>,
            icon: <Hdd />
        }
    ];

    const parts = [ner
        ? `${totals.utterances} utterances with ${annotation?.spans ?? 0} spans across ${totals.labels} entities`
        : `${totals.utterances} utterances across ${totals.labels} labels`];
    if (best) parts.push(`best version v${best.version} at ${pct(best.accuracy)} test ${ner ? "token accuracy" : "accuracy"}`);
    if (weakest) parts.push(`weakest ${thing} “${weakest[0]}” at ${weakest[1].toFixed(2)} F1`);
    const production = deployed.find((entry) => entry.environment === "production");
    parts.push(production ? `production serving v${production.version}` : "nothing in production yet");
    const summary = parts.join("; ") + ".";

    const warns = [];
    if (imbalance && imbalance.ratio >= RATIO_LIMIT) warns.push({
        text: `Imbalanced dataset — ${imbalance.max.name} (${imbalance.max.count}) is ${imbalance.ratio}× larger than ${imbalance.min.name} (${imbalance.min.count}).`,
        tab: "dataset"
    });
    const sparse = (dataset?.labels || []).filter((label) => label.count > 0 && label.count < MIN_EXAMPLES);
    if (sparse.length) warns.push({
        text: `${sparse.length} ${sparse.length > 1 ? `${things} have` : `${thing} has`} fewer than ${MIN_EXAMPLES} ${ner ? "spans" : "utterances"}: ${sparse.slice(0, 3).map((label) => label.name).join(", ")}${sparse.length > 3 ? "…" : ""}.`,
        tab: "dataset"
    });
    if (totals.empty) warns.push({
        text: `${totals.empty} ${totals.empty > 1 ? `${things} have` : `${thing} has`} no ${ner ? "spans" : "utterances"} yet.`,
        to: "build"
    });
    if (ner && annotation && totals.utterances) {
        const unannotated = totals.utterances - annotation.annotated;
        if (unannotated > 0) warns.push({
            text: `${unannotated} utterance${unannotated > 1 ? "s carry" : " carries"} no spans — they train as all-O (fine if intentional).`,
            tab: "dataset"
        });
    }
    if (dataset?.duplicates?.conflicts) warns.push({
        text: `${dataset.duplicates.conflicts} utterance${dataset.duplicates.conflicts > 1 ? "s appear" : " appears"} under more than one label.`,
        tab: "dataset"
    });
    if (latest) {
        const weak = Object.entries(latest.labels || {})
            .filter(([, f1]) => f1 != null && f1 < WEAK_F1)
            .sort((a, b) => a[1] - b[1]);
        if (weak.length) warns.push({
            text: `Weak ${thing} F1 in v${latest.version}: ${weak.slice(0, 3).map(([name, f1]) => `${name} (${f1.toFixed(2)})`).join(", ")}${weak.length > 3 ? "…" : ""}.`,
            tab: "model"
        });
        if (latest.gap != null && latest.gap > GAP_LIMIT) warns.push({
            text: `v${latest.version} may be overfit — train accuracy exceeds test by ${(latest.gap * 100).toFixed(0)} points.`,
            tab: "model"
        });
    }
    const stale = deployed.filter((entry) => entry.stale);
    if (stale.length) warns.push({
        text: `${stale.map((entry) => entry.environment).join(", ")} ${stale.length > 1 ? "are" : "is"} serving a version retrained after deployment.`,
        to: "publish"
    });

    const trend = versions.map((version) => ({ version: version.version, "test accuracy": version.accuracy }));

    return (
        <>
            <Strip items={items} />
            <Row className="g-3 mt-1">
                <Col xs={12}>
                    <Card className="border-light">
                        <Card.Body className="p-3 d-flex align-items-center gap-3">
                            <InfoCircle className="text-primary fs-4 flex-shrink-0" />
                            <span className="small">{summary}</span>
                        </Card.Body>
                    </Card>
                </Col>
                <Col xs={12}>
                    <Card className="border-light overflow-hidden">
                        <CardHeading
                            icon={<ExclamationTriangle />}
                            title="Needs attention"
                            right={warns.length > 0 && (
                                <Badge bg="warning" text="dark">{warns.length}</Badge>
                            )}
                        />
                        <ListGroup variant="flush">
                            {warns.length ? warns.map((warn, index) => (
                                <ListGroup.Item key={index} className="d-flex align-items-center gap-2 py-2 small">
                                    <ExclamationTriangle className="text-warning flex-shrink-0" />
                                    <span>{warn.text}</span>
                                    {warn.tab ? (
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="ms-auto p-0 text-decoration-none text-nowrap"
                                            onClick={() => goto(warn.tab)}
                                        >
                                            {warn.tab} →
                                        </Button>
                                    ) : (
                                        <Link className="ms-auto small text-decoration-none text-nowrap" to={`/models/${modelId}/${warn.to}`}>
                                            {warn.to} →
                                        </Link>
                                    )}
                                </ListGroup.Item>
                            )) : (
                                <ListGroup.Item className="d-flex align-items-center gap-2 py-2 small">
                                    <Check2Circle className="text-success flex-shrink-0" />
                                    <span>All clear — nothing needs attention.</span>
                                </ListGroup.Item>
                            )}
                        </ListGroup>
                    </Card>
                </Col>
                <Col lg={6}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<Database />}
                            title={ner ? "Entity distribution" : "Label distribution"}
                            right={
                                <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => goto("dataset")}>
                                    dataset →
                                </Button>
                            }
                        />
                        <Card.Body className="p-3">
                            <div style={{ height: "220px" }}>
                                {dataset?.labels?.length ? (
                                    <LabelBars labels={dataset.labels} imbalance={imbalance} colored={ner} name={ner ? "spans" : "utterances"} />
                                ) : (
                                    <EmptyMessage icon={<Database />}>No {things} yet.</EmptyMessage>
                                )}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={6}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<GraphUp />}
                            title="Accuracy trend"
                            right={
                                <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => goto("model")}>
                                    model →
                                </Button>
                            }
                        />
                        <Card.Body className="p-3">
                            <div style={{ height: "220px" }}>
                                {versions.length ? (
                                    <TrendLines data={trend} lines={[{ key: "test accuracy", color: BLUE }]} />
                                ) : (
                                    <EmptyMessage icon={<GraphUp />}>No successful training yet.</EmptyMessage>
                                )}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </>
    );
};

export default Overview;
