import { useContext, useState } from "react";
import { Badge, Button, ButtonGroup, Card, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import {
    ArrowLeftRight,
    BarChartFill,
    ChatSquareText,
    Database,
    Diagram2,
    ExclamationTriangle,
    Files,
    Fonts,
    Hash,
    PencilSquare,
    Rulers,
    Table as TableIcon,
    Tags,
    Bookmarks
} from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { UserContext } from "../../../../../contexts/UserContext";
import { CardHeading, EmptyMessage, EmptyState } from "../../../../../shared/components/SectionCard";
import { pct } from "../../../../../shared/utils/training";
import ChartCard from "./ChartCard";
import Strip from "./Strip";
import { Hist, LabelBars, TEAL, ORANGE } from "./charts";

const range = (bin) => (bin.lo === bin.hi ? `${bin.lo}` : `${bin.lo}–${bin.hi}`);

// Dataset composition and quality: distribution, duplicates, lengths,
// vocabulary, and drift of the current data against a training snapshot.
// For named entity recognition the distribution counts annotated spans per
// entity and the `annotation` block adds coverage, span lengths and
// co-occurrence. Language understanding composes both: the distribution is
// utterances per intent, a second card shows spans per slot, and the
// annotation panels read exactly as they do for named entity recognition.
const Dataset = ({ dataset, versions, ner, nlu }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [sort, setSort] = useState("name");
    const [view, setView] = useState("chart");
    const [unit, setUnit] = useState("tokens");
    const [vocabLabel, setVocabLabel] = useState("");
    const [sinceId, setSinceId] = useState("");
    const [coverage, setCoverage] = useState(null);

    if (!dataset) return null;
    const { totals, imbalance, duplicates, lengths, vocab, annotation } = dataset;
    const thing = ner ? "entity" : nlu ? "intent" : "label";
    const unitName = ner ? "spans" : "utterances";
    const slots = dataset.slots || [];
    const entities = dataset.entities || [];

    if (!totals.labels) {
        return (
            <EmptyState icon={<Bookmarks />}>
                No {ner ? "entities" : nlu ? "intents" : "labels"} yet — author your dataset
                in <Link to={`/models/${modelId}/build${nlu ? "?tab=intents" : ""}`}>Build</Link>.
            </EmptyState>
        );
    }

    const labels = [...dataset.labels].sort(
        sort === "count"
            ? (a, b) => b.count - a.count
            : (a, b) => a.name.localeCompare(b.name)
    );
    const bins = lengths[unit].map((bin) => ({ ...bin, range: range(bin) }));
    const spanBins = (annotation?.span_lengths || []).map((bin) => ({ ...bin, range: range(bin) }));
    const tokens = vocabLabel ? vocab.labels[vocabLabel] || [] : vocab.top;
    const distributionTotal = ner ? annotation?.spans : totals.utterances;

    const loadCoverage = async (id) => {
        setSinceId(id);
        if (!id) {
            setCoverage(null);
            return;
        }
        try {
            setCoverage({ state: "loading" });
            const response = await axios.get(`/api/models/${modelId}/analytics/coverage`, {
                params: { training_id: id },
                headers: { Authorization: `Bearer ${user.token}` }
            });
            setCoverage({ state: "ready", ...response.data });
        } catch (error) {
            setCoverage({
                state: error.response?.status === 404 ? "missing" : "error",
                message: error.response?.data?.error || error.message
            });
        }
    };

    const items = ner ? [
        { label: "Utterances", value: totals.utterances, icon: <ChatSquareText /> },
        {
            label: "Entities",
            value: `${totals.labels}${totals.empty ? ` · ${totals.empty} empty` : ""}`,
            icon: <Tags />
        },
        {
            label: "Annotated",
            value: annotation ? `${annotation.annotated} (${pct(annotation.coverage)})` : "-",
            icon: <PencilSquare />
        },
        { label: "Spans", value: annotation?.spans, icon: <Hash /> },
        {
            label: "Entity tokens",
            value: annotation?.tokens?.total
                ? pct(annotation.tokens.entity / annotation.tokens.total)
                : "-",
            icon: <Fonts />
        },
        {
            label: "Imbalance",
            value: imbalance ? `${imbalance.ratio} : 1` : "-",
            icon: <BarChartFill />
        }
    ] : nlu ? [
        { label: "Utterances", value: totals.utterances, icon: <ChatSquareText /> },
        {
            label: "Intents",
            value: `${totals.labels}${totals.empty ? ` · ${totals.empty} empty` : ""}`,
            icon: <Bookmarks />
        },
        { label: "Slots", value: `${slots.length} · ${entities.length} entit${entities.length === 1 ? "y" : "ies"}`, icon: <Diagram2 /> },
        {
            label: "With ≥1 slot",
            value: annotation ? `${annotation.annotated} (${pct(annotation.coverage)})` : "-",
            icon: <PencilSquare />
        },
        { label: "Slot spans", value: annotation?.spans, icon: <Hash /> },
        {
            label: "Imbalance",
            value: imbalance ? `${imbalance.ratio} : 1` : "-",
            icon: <BarChartFill />
        }
    ] : [
        { label: "Utterances", value: totals.utterances, icon: <ChatSquareText /> },
        {
            label: "Labels",
            value: `${totals.labels}${totals.empty ? ` · ${totals.empty} empty` : ""}`,
            icon: <Bookmarks />
        },
        { label: "Mean / label", value: totals.mean, icon: <Hash /> },
        { label: "Median / label", value: totals.median, icon: <Hash /> },
        {
            label: "Imbalance",
            value: imbalance ? `${imbalance.ratio} : 1` : "-",
            icon: <BarChartFill />
        }
    ];

    return (
        <>
            <Strip items={items} />
            <Row className="g-3 mt-1">
                <Col xs={12}>
                    <ChartCard
                        icon={<Database />}
                        title={ner ? "Entity distribution" : nlu ? "Intent distribution" : "Label distribution"}
                        name={ner ? "entity_distribution" : nlu ? "intent_distribution" : "label_distribution"}
                        height={300}
                        right={
                            <>
                                <ButtonGroup size="sm">
                                    <Button variant={view === "chart" ? "secondary" : "light"} className="border" title="Chart" onClick={() => setView("chart")}>
                                        <BarChartFill />
                                    </Button>
                                    <Button variant={view === "table" ? "secondary" : "light"} className="border" title="Table" onClick={() => setView("table")}>
                                        <TableIcon />
                                    </Button>
                                </ButtonGroup>
                                <Form.Select size="sm" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: "auto" }} aria-label={`Sort ${thing}s`}>
                                    <option value="name">A–Z</option>
                                    <option value="count">by count</option>
                                </Form.Select>
                            </>
                        }
                        csv={() => [[thing, unitName], ...labels.map((label) => [label.name, label.count])]}
                        foot={imbalance && `largest ${imbalance.max.name} (${imbalance.max.count}) · smallest ${imbalance.min.name} (${imbalance.min.count}) · imbalance ${imbalance.ratio}:1`}
                    >
                        {view === "chart" ? (
                            <LabelBars labels={labels} imbalance={imbalance} colored={ner || nlu} name={unitName} />
                        ) : (
                            <Table hover size="sm" className="mb-0 small align-middle">
                                <thead className="bg-body-tertiary sticky-top">
                                    <tr>
                                        <th>{ner ? "Entity" : nlu ? "Intent" : "Label"}</th>
                                        <th className="text-end">{ner ? "Spans" : "Utterances"}</th>
                                        <th className="text-end">Share</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {labels.map((label) => (
                                        <tr key={label.id}>
                                            <td>
                                                {(ner || nlu) && label.color && (
                                                    <span
                                                        className="d-inline-block me-2 rounded-circle"
                                                        style={{ width: "8px", height: "8px", backgroundColor: label.color }}
                                                    />
                                                )}
                                                {label.name}
                                            </td>
                                            <td className="text-end font-monospace">{label.count}</td>
                                            <td className="text-end font-monospace">
                                                {distributionTotal ? `${(label.count / distributionTotal * 100).toFixed(1)}%` : "-"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </ChartCard>
                </Col>
                {nlu && (
                    <Col xs={12}>
                        <ChartCard
                            icon={<Diagram2 />}
                            title="Slot distribution"
                            name="slot_distribution"
                            height={260}
                            csv={() => [["slot", "spans"], ...slots.map((slot) => [slot.name, slot.count])]}
                            foot="annotated spans per slot — utterances with no spans still train (as all-O)"
                        >
                            {slots.length ? (
                                <LabelBars labels={slots} colored name="spans" />
                            ) : (
                                <EmptyMessage icon={<Diagram2 />}>
                                    No slots yet — open an intent in{" "}
                                    <Link to={`/models/${modelId}/build?tab=intents`}>Build</Link>{" "}
                                    and define its slots there.
                                </EmptyMessage>
                            )}
                        </ChartCard>
                    </Col>
                )}
                {nlu && (
                    <Col xs={12}>
                        <ChartCard
                            icon={<Tags />}
                            title="Entity distribution"
                            name="entity_distribution"
                            height={260}
                            csv={() => [["entity", "spans", "distinct values"], ...entities.map((entity) => [entity.name, entity.count, entity.values])]}
                            foot="annotated spans per entity, across every slot mapping to it — value diversity in parentheses"
                        >
                            {entities.length ? (
                                <LabelBars
                                    labels={entities.map((entity) => ({
                                        ...entity,
                                        name: entity.values != null ? `${entity.name} (${entity.values})` : entity.name
                                    }))}
                                    colored
                                    name="spans"
                                />
                            ) : (
                                <EmptyMessage icon={<Tags />}>
                                    No entities yet — define them in the Entities tab of{" "}
                                    <Link to={`/models/${modelId}/build?tab=entities`}>Build</Link>.
                                </EmptyMessage>
                            )}
                        </ChartCard>
                    </Col>
                )}
                {(ner || nlu) && (
                    <>
                        <Col lg={6}>
                            <ChartCard
                                icon={<Rulers />}
                                title="Span length"
                                name="span_length"
                                height={260}
                                csv={() => [["from", "to", "spans"], ...spanBins.map((bin) => [bin.lo, bin.hi, bin.n])]}
                                foot={annotation?.tokens
                                    ? `span length in whitespace tokens · ${annotation.tokens.entity} of ${annotation.tokens.total} tokens sit inside a span; the other ${annotation.tokens.outside} train as O`
                                    : "span length in whitespace tokens"}
                            >
                                {spanBins.length ? (
                                    <Hist bins={spanBins} color={ORANGE} name="spans" />
                                ) : (
                                    <EmptyMessage icon={<Rulers />}>No annotated spans yet.</EmptyMessage>
                                )}
                            </ChartCard>
                        </Col>
                        <Col lg={6}>
                            <Card className="border-light overflow-hidden h-100">
                                <CardHeading
                                    icon={<Diagram2 />}
                                    title={nlu ? "Slot co-occurrence" : "Entity co-occurrence"}
                                    right={<span className="text-muted" style={{ fontSize: "0.7rem" }}>{nlu ? "slots" : "entities"} annotated in the same utterance</span>}
                                />
                                <Card.Body className="p-0">
                                    {annotation?.cooccurrence?.length ? (
                                        <div className="overflow-auto" style={{ maxHeight: "300px" }}>
                                            <Table hover size="sm" className="mb-0 small align-middle">
                                                <thead className="bg-body-tertiary sticky-top">
                                                    <tr>
                                                        <th className="px-3">{nlu ? "Slot pair" : "Entity pair"}</th>
                                                        <th className="text-end pe-3">Utterances</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {annotation.cooccurrence.map((pair) => (
                                                        <tr key={`${pair.a}+${pair.b}`}>
                                                            <td className="px-3">
                                                                <span className="d-inline-flex flex-wrap gap-1">
                                                                    <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">{pair.a}</Badge>
                                                                    <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">{pair.b}</Badge>
                                                                </span>
                                                            </td>
                                                            <td className="text-end pe-3 font-monospace">{pair.count}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </Table>
                                        </div>
                                    ) : (
                                        <EmptyMessage icon={<Diagram2 />}>
                                            No utterance carries two different {nlu ? "slots" : "entities"} yet.
                                        </EmptyMessage>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </>
                )}
                {nlu && (
                    <Col lg={6}>
                        <Card className="border-light overflow-hidden h-100">
                            <CardHeading
                                icon={<Diagram2 />}
                                title="Intent ↔ slot"
                                right={<span className="text-muted" style={{ fontSize: "0.7rem" }}>which slots each intent's utterances carry</span>}
                            />
                            <Card.Body className="p-0">
                                {annotation?.intent_slots?.length ? (
                                    <div className="overflow-auto" style={{ maxHeight: "300px" }}>
                                        <Table hover size="sm" className="mb-0 small align-middle">
                                            <thead className="bg-body-tertiary sticky-top">
                                                <tr>
                                                    <th className="px-3">Intent</th>
                                                    <th>Slot</th>
                                                    <th className="text-end pe-3">Spans</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {annotation.intent_slots.map((pair) => (
                                                    <tr key={`${pair.intent}+${pair.slot}`}>
                                                        <td className="px-3">
                                                            <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">{pair.intent}</Badge>
                                                        </td>
                                                        <td>
                                                            <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">{pair.slot}</Badge>
                                                        </td>
                                                        <td className="text-end pe-3 font-monospace">{pair.count}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    </div>
                                ) : (
                                    <EmptyMessage icon={<Diagram2 />}>
                                        No annotated spans on intent-labelled utterances yet.
                                    </EmptyMessage>
                                )}
                            </Card.Body>
                        </Card>
                    </Col>
                )}
                <Col lg={6}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<Files />}
                            title="Duplicates"
                            right={
                                <span className={duplicates.conflicts ? "text-danger" : "text-muted"} style={{ fontSize: "0.7rem" }}>
                                    {duplicates.exact} exact · {duplicates.near} near
                                    {!ner && ` · ${duplicates.conflicts} conflicts`}
                                </span>
                            }
                        />
                        <Card.Body className="p-0">
                            {duplicates.items.length ? (
                                <div className="overflow-auto" style={{ maxHeight: "320px" }}>
                                    <Table hover size="sm" className="mb-0 small align-middle">
                                        <thead className="bg-body-tertiary sticky-top">
                                            <tr>
                                                <th className="px-3">Text</th>
                                                {!ner && <th>{nlu ? "Intents" : "Labels"}</th>}
                                                <th className="text-end pe-3">Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {duplicates.items.map((item, index) => (
                                                <tr key={index}>
                                                    <td className="px-3 text-break">{item.text}</td>
                                                    {!ner && (
                                                        <td>
                                                            <span className="d-inline-flex flex-wrap gap-1">
                                                                {item.labels.map((name) => (
                                                                    <Badge
                                                                        key={name}
                                                                        bg={item.labels.length > 1 ? "danger-subtle" : "secondary-subtle"}
                                                                        text={item.labels.length > 1 ? "danger-emphasis" : "body-emphasis"}
                                                                        className="border fw-normal"
                                                                    >
                                                                        {name}
                                                                    </Badge>
                                                                ))}
                                                            </span>
                                                        </td>
                                                    )}
                                                    <td className="text-end pe-3 font-monospace">{item.n}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            ) : (
                                <EmptyMessage icon={<Files />}>No duplicate utterances.</EmptyMessage>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={6}>
                    <ChartCard
                        icon={<Rulers />}
                        title="Utterance length"
                        name="utterance_length"
                        height={260}
                        right={
                            <ButtonGroup size="sm">
                                <Button variant={unit === "tokens" ? "secondary" : "light"} className="border" onClick={() => setUnit("tokens")}>
                                    tokens
                                </Button>
                                <Button variant={unit === "chars" ? "secondary" : "light"} className="border" onClick={() => setUnit("chars")}>
                                    chars
                                </Button>
                            </ButtonGroup>
                        }
                        csv={() => [["from", "to", "utterances"], ...bins.map((bin) => [bin.lo, bin.hi, bin.n])]}
                        foot={`utterance length in ${unit === "tokens" ? "whitespace tokens" : "characters"} — long tails risk truncation at training time`}
                    >
                        {bins.length ? (
                            <Hist bins={bins} color={TEAL} />
                        ) : (
                            <EmptyMessage icon={<Rulers />}>No utterances yet.</EmptyMessage>
                        )}
                    </ChartCard>
                </Col>
                <Col lg={6}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<Fonts />}
                            title="Vocabulary"
                            right={
                                <Form.Select size="sm" value={vocabLabel} onChange={(e) => setVocabLabel(e.target.value)} style={{ width: "auto" }} aria-label={`Vocabulary ${thing}`}>
                                    <option value="">{ner ? "whole dataset" : nlu ? "all intents" : "all labels"}</option>
                                    {dataset.labels.filter((label) => label.count).map((label) => (
                                        <option key={label.id} value={label.name}>{label.name}</option>
                                    ))}
                                </Form.Select>
                            }
                        />
                        <Card.Body className="p-3">
                            <div className="small text-muted mb-3">
                                {vocab.unique} unique tokens across the dataset
                                {vocabLabel && (ner
                                    ? ` · top tokens inside ${vocabLabel} spans`
                                    : ` · top tokens for ${vocabLabel}`)}
                            </div>
                            {tokens.length ? (
                                <div className="d-flex flex-wrap gap-2">
                                    {tokens.map(([token, count]) => (
                                        <Badge key={token} bg="secondary-subtle" text="body-emphasis" className="border fw-normal font-monospace">
                                            {token} <span className="text-muted">×{count}</span>
                                        </Badge>
                                    ))}
                                </div>
                            ) : (
                                <EmptyMessage icon={<Fonts />}>No tokens yet.</EmptyMessage>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={6}>
                    <Card className="border-light overflow-hidden h-100">
                        <CardHeading
                            icon={<ArrowLeftRight />}
                            title="Changes since training"
                            right={
                                <Form.Select size="sm" value={sinceId} onChange={(e) => loadCoverage(e.target.value)} style={{ width: "auto" }} aria-label="Compare against version">
                                    <option value="">select version</option>
                                    {[...versions].reverse().map((version) => (
                                        <option key={version.id} value={version.id}>v{version.version}</option>
                                    ))}
                                </Form.Select>
                            }
                        />
                        <Card.Body className="p-3">
                            {!coverage ? (
                                <EmptyMessage icon={<ArrowLeftRight />}>
                                    Pick a version to compare the current dataset against its training snapshot.
                                </EmptyMessage>
                            ) : coverage.state === "loading" ? (
                                <div className="d-flex justify-content-center py-5">
                                    <Spinner animation="border" size="sm" variant="secondary" />
                                </div>
                            ) : coverage.state === "ready" ? (
                                <div className="d-flex flex-column gap-2 small py-2">
                                    <div className="d-flex align-items-center gap-2">
                                        <Badge bg="success-subtle" text="success-emphasis" className="border font-monospace">+{coverage.added}</Badge>
                                        <span>added and</span>
                                        <Badge bg="danger-subtle" text="danger-emphasis" className="border font-monospace">−{coverage.removed}</Badge>
                                        <span>removed since v{coverage.version}</span>
                                    </div>
                                    <div className="text-muted">
                                        {coverage.snapshot} utterances at training time → {coverage.current} now
                                        {ner && " · a re-annotated utterance counts as one removal plus one addition"}
                                    </div>
                                </div>
                            ) : (
                                <EmptyMessage icon={<ExclamationTriangle />}>
                                    {coverage.state === "missing"
                                        ? "Training snapshot unavailable — the stored data for this version has been evicted."
                                        : coverage.message}
                                </EmptyMessage>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </>
    );
};

export default Dataset;
