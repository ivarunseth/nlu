import { useMemo, useState } from "react";
import { Alert, Badge, Button } from "react-bootstrap";
import { Clipboard, ClipboardCheck, ExclamationTriangle, SortDown } from "react-bootstrap-icons";
import { SectionLabel, EmptyState } from "../../../../../shared/components/SectionCard";
import TokenTags from "../../../../../shared/components/TokenTags";
import EntityHighlights from "../../../../../shared/components/EntityHighlights";
import { entityColor } from "../../../../../shared/components/entityColors";

// Prediction rendering shared by the Test page's single, compare and batch
// result surfaces. The output shape is self-describing, so no model-type
// flag is threaded through: text classification is { labels: [{ name,
// score }] }, natural language understanding is { intents: [{ name, score }],
// entities: [...] }, named entity recognition is { tags, entities }.

// A prediction that is a plain error payload rather than a model output.
export const isErrorPrediction = (prediction) =>
    prediction != null && typeof prediction === "object" && !Array.isArray(prediction) && prediction.error;

// The ranked [{ name, score }] label list of a text-classification
// prediction, or null for other model types (compared as a whole instead).
export const getLabels = (prediction) =>
    prediction != null && typeof prediction === "object" && !Array.isArray(prediction) && Array.isArray(prediction.labels)
        ? prediction.labels
        : null;

// The [{ entity, value, start, end, score }] list of a named-entity-recognition
// prediction (possibly empty), or null when the prediction is not NER. NER
// predictions are self-describing by their `tags` array.
export const getEntities = (prediction) =>
    prediction != null && typeof prediction === "object" && !Array.isArray(prediction) && Array.isArray(prediction.tags)
        ? (Array.isArray(prediction.entities) ? prediction.entities : [])
        : null;

// The ranked [{ name, score }] intent list of a natural-language-understanding
// prediction, or null for other model types. NLU predictions are
// self-describing by their `intents` array.
export const getIntents = (prediction) =>
    prediction != null && typeof prediction === "object" && !Array.isArray(prediction) && Array.isArray(prediction.intents)
        ? prediction.intents
        : null;

// The [{ slot, entity, value, start, end, score }] span list of an NLU
// prediction (possibly empty), or null when the prediction is not NLU.
// Older payloads carried the slot under `name` and no entity.
export const getSlotEntities = (prediction) =>
    getIntents(prediction) != null
        ? (Array.isArray(prediction.entities) ? prediction.entities : [])
        : null;

// A prediction span's slot name, tolerating the pre-split `name` key.
export const slotOf = (span) => span.slot ?? span.name;

export const scoresClose = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-6;

export const ScoreBar = ({ score, variant = "primary" }) => {
    const percent = Math.max(0, Math.min(100, (score || 0) * 100));
    return (
        <div className="d-flex align-items-center gap-3">
            <div className="flex-grow-1 bg-body-secondary rounded-pill" style={{ height: "10px", overflow: "hidden" }}>
                <div
                    className={`bg-${variant} h-100 rounded-pill`}
                    style={{ width: `${percent}%`, transition: "width 0.4s ease" }}
                />
            </div>
            <span className={`font-monospace fw-bold ${variant === "warning" ? "text-warning-emphasis" : "text-body-emphasis"}`} style={{ minWidth: "64px", textAlign: "right" }}>
                {percent.toFixed(2)}%
            </span>
        </div>
    );
};

// `reference` is development's prediction; when supplied, each output whose
// label differs is flagged in danger and each whose score differs (same label)
// gets a warning score bar. `colorOf` maps an entity/slot name to a colour and
// is threaded to the entity highlights and IOB token chips so a prediction
// paints each entity in the colour assigned to it in Build (not a hash); when
// omitted, those components fall back to the deterministic name-based palette.
export const PredictionView = ({ prediction, query, reference, colorOf }) => {
    if (prediction == null) {
        return <EmptyState icon={<SortDown />} minHeight="100%">Run a query to see the result.</EmptyState>;
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
    const labels = getLabels(prediction);
    if (labels) {
        const referenceLabels = getLabels(reference);
        return (
            <div>
                <SectionLabel>{labels.length > 1 ? "Predicted labels" : "Predicted label"}</SectionLabel>
                <div className="mt-3 d-flex flex-column gap-3">
                    {labels.map((item, index) => {
                        const referenceLabel = referenceLabels ? referenceLabels[index] : null;
                        const labelMismatch = referenceLabel != null && referenceLabel.name !== item.name;
                        const scoreMismatch = referenceLabel != null && !labelMismatch && !scoresClose(referenceLabel.score, item.score);
                        return (
                            <div key={index}>
                                <div className="d-flex align-items-center gap-2 mb-2">
                                    <Badge
                                        bg={labelMismatch ? "danger" : index === 0 ? "primary" : "secondary-subtle"}
                                        text={labelMismatch || index === 0 ? undefined : "body-emphasis"}
                                        className="fw-medium px-3 py-2 border"
                                    >
                                        {item.name}
                                    </Badge>
                                </div>
                                <ScoreBar score={item.score} variant={scoreMismatch ? "warning" : "primary"} />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Natural language understanding: { intents: [{ name, score }, ...],
    // entities: [{ name, value, start, end, score }, ...] } — the ranked
    // intents as badge + score bar (classification-style) and the predicted
    // slots highlighted over the query (named-entity-style).
    const intents = getIntents(prediction);
    if (intents) {
        const referenceIntents = getIntents(reference);
        const slotEntities = getSlotEntities(prediction);
        return (
            <div>
                <div className={slotEntities.length > 0 ? "mb-4" : undefined}>
                    <SectionLabel>{intents.length > 1 ? "Predicted intents" : "Predicted intent"}</SectionLabel>
                    <div className="mt-3 d-flex flex-column gap-3">
                        {intents.map((item, index) => {
                            const referenceIntent = referenceIntents ? referenceIntents[index] : null;
                            const intentMismatch = referenceIntent != null && referenceIntent.name !== item.name;
                            const scoreMismatch = referenceIntent != null && !intentMismatch && !scoresClose(referenceIntent.score, item.score);
                            return (
                                <div key={index}>
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                        <Badge
                                            bg={intentMismatch ? "danger" : index === 0 ? "primary" : "secondary-subtle"}
                                            text={intentMismatch || index === 0 ? undefined : "body-emphasis"}
                                            className="fw-medium px-3 py-2 border"
                                        >
                                            {item.name}
                                        </Badge>
                                    </div>
                                    <ScoreBar score={item.score} variant={scoreMismatch ? "warning" : "primary"} />
                                </div>
                            );
                        })}
                    </div>
                </div>
                {slotEntities.length > 0 && (
                    <div>
                        <SectionLabel>Slots</SectionLabel>
                        <div className="mt-2">
                            <EntityHighlights
                                text={query}
                                // EntityHighlights labels spans by their
                                // `entity` key; label by slot (the role) and
                                // colour by the slot's entity type, so
                                // `source` and `destination` read as roles
                                // but share their `location` colour.
                                entities={slotEntities.map((span) => ({ ...span, entity: slotOf(span) }))}
                                colorOf={(name) => {
                                    const span = slotEntities.find((item) => slotOf(item) === name);
                                    return (colorOf || entityColor)(span?.entity || name);
                                }}
                            />
                        </div>
                        <div className="mt-2 d-flex flex-wrap gap-2">
                            {[...new Map(slotEntities.map((span) => [slotOf(span), span.entity])).entries()].map(([slot, entity]) => (
                                <span key={slot} className="border rounded-pill px-2 py-1 small text-muted">
                                    {slot}
                                    {entity && <span className="ms-1">→ {entity}</span>}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Legacy natural language understanding payloads: { intent, slots: [...] }
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
                            <TokenTags query={query} tags={prediction.slots} colorOf={colorOf} />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Named entity recognition: { tags: [...], entities: [...] } with one IOB
    // tag per whitespace token of the query. Show the reconstructed entities
    // highlighted over the query, then the per-token IOB chips.
    const entities = getEntities(prediction);
    if (entities) {
        return (
            <div>
                {entities.length > 0 && (
                    <div className="mb-4">
                        <SectionLabel>Entities</SectionLabel>
                        <div className="mt-2">
                            <EntityHighlights text={query} entities={entities} colorOf={colorOf} />
                        </div>
                    </div>
                )}
                <SectionLabel>Tokens</SectionLabel>
                <div className="mt-2">
                    <TokenTags query={query} tags={prediction.tags} colorOf={colorOf} />
                </div>
            </div>
        );
    }

    return <pre className="p-3 mb-0 bg-body-tertiary border-0 rounded small">{JSON.stringify(prediction, null, 2)}</pre>;
};

// Classic JSON syntax-highlight palette (keys / strings / numbers / booleans /
// null); per-theme values live in index.css.
const JSON_COLORS = {
    key: "var(--app-json-key)",
    string: "var(--app-json-string)",
    number: "var(--app-json-number)",
    boolean: "var(--app-json-boolean)",
    null: "var(--app-json-null)"
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

export const JsonView = ({ data }) => {
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
        <div className="position-relative h-100">
            <Button
                variant="light"
                size="sm"
                className="border position-absolute end-0 top-0 m-2 d-inline-flex align-items-center gap-1"
                onClick={handleCopy}
            >
                {copied ? <ClipboardCheck className="text-success" /> : <Clipboard />}
            </Button>
            <pre
                className="p-3 mb-0 bg-body-tertiary border-0 rounded small overflow-auto h-100"
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
};
