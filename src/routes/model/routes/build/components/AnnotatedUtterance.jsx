import { Fragment, useMemo, useRef, useState } from "react";
import { Badge, Button, Form, ListGroup } from "react-bootstrap";
import { BracesAsterisk, Check2, Pen, Trash, XLg } from "react-bootstrap-icons";
import TokenTags from "../../../../../shared/components/TokenTags";
import { entityColor, readableTextColor } from "../../../../../shared/components/entityColors";
import { formatInline } from "../../../../../shared/utils/inline";
import EntityPicker from "./EntityPicker";

// Snap a selection to whole whitespace tokens: trim edge whitespace, then
// grow both ends to the enclosing tokens. Mirrors the server's tokenizer so
// stored spans always align with the IOB tags derived from them.
const snapToTokens = (text, start, end) => {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
    return [start, end];
};

// Character offset of a selection boundary within the utterance text. Every
// text segment carries its start offset in data-start; boundaries landing
// outside a segment (e.g. on an entity chip) return null and are ignored.
const offsetWithin = (container, node, offsetInNode) => {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const segment = element?.closest?.("[data-start]");
    if (!segment || !container.contains(segment)) return null;
    return Number(segment.dataset.start) + offsetInNode;
};

// One utterance row of the annotation workspace: colour-highlighted entity
// spans over the text, select-to-annotate via the entity popover, per-span
// removal, seamless inline editing (text + annotations as {entity: value}
// markup) and an IOB tag preview.
const AnnotatedUtterance = ({
    number,
    utterance,
    entities,
    suggestions = {},
    onAnnotate,
    onRemoveAnnotation,
    onEdit,
    onDelete,
    onAlert
}) => {
    const containerRef = useRef(null);
    const [picker, setPicker] = useState(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [showTags, setShowTags] = useState(false);

    const { text, annotations = [], tags = [] } = utterance;

    // Colour the IOB preview chips with each entity's chosen colour, so the
    // B-/I- tags read in the same colour language as the highlighted spans.
    // Falls back to the deterministic palette for any name not in the registry.
    const colorOf = useMemo(() => {
        const byName = new Map(entities.map((entity) => [entity.name, entity.color]));
        annotations.forEach((annotation) => {
            if (!byName.has(annotation.label)) byName.set(annotation.label, annotation.color);
        });
        return (name) => byName.get(name) || entityColor(name);
    }, [entities, annotations]);

    // Split the text into plain and annotated segments, in offset order.
    const segments = [];
    let cursor = 0;
    annotations.forEach((annotation) => {
        if (annotation.start > cursor) {
            segments.push({ start: cursor, text: text.slice(cursor, annotation.start) });
        }
        segments.push({ start: annotation.start, text: text.slice(annotation.start, annotation.end), annotation });
        cursor = annotation.end;
    });
    if (cursor < text.length || segments.length === 0) {
        segments.push({ start: cursor, text: text.slice(cursor) });
    }

    const handleMouseUp = (event) => {
        // Interacting with the picker (searching, clicking an entity) must not
        // collapse the selection and dismiss it before the pick registers.
        if (event.target.closest("[data-entity-picker]")) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            setPicker(null);
            return;
        }
        const range = selection.getRangeAt(0);
        const from = offsetWithin(containerRef.current, range.startContainer, range.startOffset);
        const to = offsetWithin(containerRef.current, range.endContainer, range.endOffset);
        if (from == null || to == null || from === to) return;

        const span = snapToTokens(text, Math.min(from, to), Math.max(from, to));
        if (!span) return;
        const [start, end] = span;

        if (annotations.some((annotation) => start < annotation.end && end > annotation.start)) {
            onAlert("Spans cannot overlap: remove the existing annotation first.");
            selection.removeAllRanges();
            return;
        }

        const rect = range.getBoundingClientRect();
        const container = containerRef.current.getBoundingClientRect();
        // Cap the popover to the (possibly narrow) container's width so it
        // wraps instead of forcing the page to scroll horizontally, and clamp
        // its left edge so it never spills past the container's right side.
        const maxWidth = Math.max(160, Math.min(280, container.width - 8));
        const left = Math.min(Math.max(0, rect.left - container.left), Math.max(0, container.width - maxWidth));
        setPicker({ start, end, left, top: rect.bottom - container.top + 4, maxWidth });
    };

    const handlePick = (entity) => {
        window.getSelection()?.removeAllRanges();
        setPicker(null);
        onAnnotate(utterance.id, { label_id: entity.id, start: picker.start, end: picker.end });
    };

    // Enter edit mode with the utterance rendered as inline {entity: value}
    // markup, so text and its annotations are edited together in one field.
    const startEditing = () => {
        setDraft(formatInline(text, annotations));
        setEditing(true);
        setPicker(null);
    };

    const handleSave = async () => {
        const ok = await onEdit(utterance.id, draft);
        // Stay in edit mode (keeping the draft) when the markup is rejected.
        if (ok) setEditing(false);
    };

    return (
        <ListGroup.Item className="py-2">
            <div className="d-flex align-items-center gap-2">
                <div className="text-muted small font-monospace" style={{ minWidth: "2rem", textAlign: "right" }}>
                    {number}.
                </div>
                {editing ? (
                    <Form.Control
                        size="sm"
                        className="flex-grow-1 font-monospace"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleSave();
                            } else if (e.key === "Escape") {
                                setEditing(false);
                            }
                        }}
                    />
                ) : (
                    <div
                        ref={containerRef}
                        className="flex-grow-1 px-1 text-break position-relative"
                        style={{ lineHeight: 2, cursor: "text" }}
                        onMouseUp={handleMouseUp}
                    >
                        {segments.map((segment, index) => segment.annotation ? (
                            <Fragment key={index}>
                                <span
                                    data-start={segment.start}
                                    contentEditable={false}
                                    title={segment.annotation.label}
                                    className="badge rounded-pill ms-1 me-1 px-2 py-1"
                                    style={{
                                        backgroundColor: segment.annotation.color,
                                        color: readableTextColor(segment.annotation.color),
                                        fontSize: "0.8rem",
                                        userSelect: "none"
                                    }}
                                >
                                    {segment.text}
                                    <XLg
                                        role="button"
                                        aria-label={`Remove ${segment.annotation.label} annotation`}
                                        size={10}
                                        className="ms-2"
                                        onClick={() => onRemoveAnnotation(utterance.id, segment.annotation.id)}
                                    />
                                </span>
                            </Fragment>
                        ) : (
                            <span key={index} data-start={segment.start}>{segment.text}</span>
                        ))}
                        {picker && (
                            <EntityPicker
                                entities={entities}
                                suggestedName={suggestions[text.slice(picker.start, picker.end).toLowerCase()]}
                                onPick={handlePick}
                                onClose={() => setPicker(null)}
                                style={{ left: picker.left, top: picker.top }}
                                maxWidth={picker.maxWidth}
                            />
                        )}
                    </div>
                )}
                <Badge
                    bg="secondary-subtle"
                    text="muted"
                    className="border fw-normal font-monospace flex-shrink-0"
                    title={`${annotations.length} annotated span${annotations.length === 1 ? "" : "s"}`}
                >
                    {annotations.length}
                </Badge>
                {editing ? (
                    <Button
                        variant="light"
                        size="sm"
                        className="border text-success d-inline-flex align-items-center flex-shrink-0"
                        title="Save utterance"
                        aria-label="Save utterance"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleSave}
                    >
                        <Check2 />
                    </Button>
                ) : (
                    <Button
                        variant="light"
                        size="sm"
                        className="border d-inline-flex align-items-center flex-shrink-0"
                        title="Edit utterance"
                        aria-label="Edit utterance"
                        onClick={startEditing}
                    >
                        <Pen />
                    </Button>
                )}
                <Button
                    variant="light"
                    size="sm"
                    className={`border d-inline-flex align-items-center flex-shrink-0 ${showTags ? "active" : ""}`}
                    title="Preview IOB tags"
                    aria-label="Preview IOB tags"
                    onClick={() => setShowTags((previous) => !previous)}
                >
                    <BracesAsterisk />
                </Button>
                <Button
                    variant="light"
                    size="sm"
                    className="border text-danger d-inline-flex align-items-center flex-shrink-0"
                    title="Delete utterance"
                    aria-label="Delete utterance"
                    onClick={() => onDelete(utterance.id)}
                >
                    <Trash />
                </Button>
            </div>
            {editing && (
                <div className="text-muted mt-1" style={{ marginLeft: "2.5rem", fontSize: "0.7rem" }}>
                    edit the text, and wrap phrases as <code>{"{entity: value}"}</code> to annotate. Enter to save, Esc to cancel.
                </div>
            )}
            {showTags && (
                <div className="mt-2" style={{ marginLeft: "2.5rem" }}>
                    <TokenTags query={text} tags={tags} colorOf={colorOf} />
                </div>
            )}
        </ListGroup.Item>
    );
};

export default AnnotatedUtterance;
