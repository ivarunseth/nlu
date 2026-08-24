import { useMemo, useRef, useState } from "react";
import { Badge, Button, ListGroup } from "react-bootstrap";
import { BracesAsterisk, Trash } from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
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

// Move spans across a text edit. The edited region is whatever is left after
// trimming the common prefix and suffix, which is all that is needed here: a
// span before it is untouched, one after it shifts by the length delta, and one
// the edit reached into is dropped — its surface string no longer means what it
// was tagged as. That last rule matches how the server prunes spans whose
// surface drifted, so a local edit and a reload agree.
const remapSpans = (spans, before, after) => {
    const limit = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < limit && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (
        suffix < limit - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix++;

    const removedEnd = before.length - suffix;
    const delta = after.length - before.length;

    return spans.reduce((kept, span) => {
        if (span.end <= prefix) kept.push(span);
        else if (span.start >= removedEnd) kept.push({ ...span, start: span.start + delta, end: span.end + delta });
        return kept;
    }, []);
};

// Undo steps kept per row, and how long consecutive typing keeps folding into
// the current step instead of starting a new one.
const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;
// Headroom a span needs above it for its name to sit there rather than below.
const TIP_CLEARANCE = 28;

// The nearest ancestor that scrolls, which is what actually clips a label
// floating above a row — the workspace list, not the viewport.
const scrollParentOf = (node) => {
    let element = node.parentElement;
    while (element) {
        const { overflowY } = window.getComputedStyle(element);
        if (overflowY === "auto" || overflowY === "scroll") return element;
        element = element.parentElement;
    }
    return null;
};

// Split text into plain and annotated segments, in offset order.
const segmentize = (text, spans) => {
    const segments = [];
    let cursor = 0;
    [...spans].sort((a, b) => a.start - b.start).forEach((span) => {
        if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start) });
        segments.push({ text: text.slice(span.start, span.end), span });
        cursor = span.end;
    });
    if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor) });
    return segments;
};

// One utterance row of the annotation workspace, edited directly in place —
// there is no edit or save button and no separate edit mode, so the highlighted
// entity spans stay on screen while typing.
//
// The row is a transparent <textarea> laid exactly over a highlight layer that
// mirrors its text. That split is deliberate: the browser keeps sole ownership
// of the text, caret, selection, undo/redo and IME, while React only ever
// renders the layer underneath. Painting spans into an editable region instead
// (contentEditable) puts React and the browser's own undo history in charge of
// the same nodes, and they disagree — undo restores nodes React has no record
// of. Because the two layers share their typography exactly, the highlights sit
// under the right characters without either side knowing about the other.
const AnnotatedUtterance = ({
    number,
    utterance,
    entities,
    suggestions = {},
    showIntent = false,
    onAnnotate,
    onEdit,
    onDelete,
    onAlert
}) => {
    const { modelId } = useParams();
    const inputRef = useRef(null);
    const fieldRef = useRef(null);
    // Which span the pointer is over, and its label placement. Tracked in a ref
    // alongside the state so mousemove only re-renders when the answer changes.
    const [hovered, setHovered] = useState(null);
    const hoveredRef = useRef(null);
    // Holds the unsaved text and its remapped spans, and is null whenever the
    // row matches what is stored — so a save or a revert is just dropping it,
    // with no effect syncing props into state and no chance of the two drifting.
    const [edit, setEdit] = useState(null);
    const [picker, setPicker] = useState(null);
    const [showTags, setShowTags] = useState(false);
    // Undo/redo is ours rather than the browser's, because an edit moves the
    // spans as well as the text and the native history only knows about text —
    // it would put a sentence back while leaving the tags on it dropped. Held
    // in a ref so recording a step never triggers a render.
    const historyRef = useRef({ past: [], future: [] });
    const typedAtRef = useRef(0);
    const committingRef = useRef(false);

    const { annotations = [], tags = [] } = utterance;
    const text = edit ? edit.text : utterance.text;
    const spans = edit ? edit.spans : annotations;

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

    const segments = segmentize(text, spans);

    // Saves the row through the same inline-markup path the create box uses.
    // A rejection keeps the pending edit so it can be corrected, not retyped.
    // Guarded against overlapping runs: losing focus and picking an entity can
    // both ask to save before the first `setEdit(null)` has been applied.
    const commit = async (pending = edit) => {
        if (!pending || committingRef.current) return true;
        committingRef.current = true;
        try {
            const ok = await onEdit(utterance.id, formatInline(pending.text, pending.spans));
            if (ok) {
                setEdit(null);
                // The saved row is the new baseline, so what came before it is
                // no longer reachable by undo.
                historyRef.current = { past: [], future: [] };
            }
            return ok;
        } finally {
            committingRef.current = false;
        }
    };

    // Focus moving between the field's own parts is not leaving the row. The
    // entity popover's search box takes focus on mount, so treating that as a
    // departure would close the popover the moment it opened — and save the
    // half-finished edit underneath it, snapping the text back mid-selection.
    const handleFieldBlur = (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setPicker(null);
        commit();
    };

    // Records the state being replaced. Consecutive typing folds into one step
    // rather than making every keystroke separately undoable.
    const record = (coalesce) => {
        const history = historyRef.current;
        const now = Date.now();
        const folding = coalesce && history.past.length > 0 && now - typedAtRef.current < COALESCE_MS;
        typedAtRef.current = now;
        history.future = [];
        if (folding) return;
        history.past.push({ text, spans });
        if (history.past.length > HISTORY_LIMIT) history.past.shift();
    };

    const restore = (from, to) => {
        const history = historyRef.current;
        if (history[from].length === 0) return;
        const previous = history[from].pop();
        history[to].push({ text, spans });
        // Typing after an undo has to start a fresh step, never fold into the
        // one that was just stepped over.
        typedAtRef.current = 0;
        setEdit(previous);
        setPicker(null);
        // Leave the caret where the two versions diverge — the spot that moved.
        let at = 0;
        while (at < previous.text.length && at < text.length && previous.text[at] === text[at]) at++;
        const input = inputRef.current;
        if (input) window.requestAnimationFrame(() => input.setSelectionRange(at, at));
    };

    const handleChange = (e) => {
        const next = e.target.value;
        // Single-character insertions are the ones worth folding together;
        // deletions and pasted chunks each get their own step.
        record(next.length === text.length + 1);
        setEdit({ text: next, spans: remapSpans(spans, text, next) });
        setPicker(null);
    };

    const handleKeyDown = (e) => {
        const key = e.key.toLowerCase();
        // Undo is intercepted unconditionally, so the browser's own text-only
        // history can never diverge from this one.
        if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === "z" || key === "y")) {
            e.preventDefault();
            const redo = key === "y" || e.shiftKey;
            restore(redo ? "future" : "past", redo ? "past" : "future");
        } else if (e.key === "Enter") {
            // Single-line: Enter saves rather than inserting a break.
            e.preventDefault();
            e.target.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            // With the popover open Escape dismisses just that (its own handler
            // does it), leaving the edit underneath untouched.
            if (picker) return;
            setEdit(null);
            historyRef.current = { past: [], future: [] };
            e.target.blur();
        }
    };

    // Offsets come straight off the textarea, so they stay correct against
    // unsaved text without measuring the rendered layer. Read at the end of a
    // gesture rather than on every selection change, so dragging across an
    // existing span reports the clash once instead of on every mouse move.
    const handleSelection = (e) => {
        const { selectionStart, selectionEnd } = e.target;
        if (selectionStart === selectionEnd) {
            setPicker(null);
            return;
        }
        const snapped = snapToTokens(text, selectionStart, selectionEnd);
        if (!snapped) return;
        const [start, end] = snapped;
        if (spans.some((span) => start < span.end && end > span.start)) {
            setPicker(null);
            onAlert("Spans cannot overlap: remove the existing annotation first.");
            return;
        }
        setPicker({ start, end, value: text.slice(start, end) });
    };

    const clearHover = () => {
        hoveredRef.current = null;
        setHovered(null);
    };

    // The highlight layer takes no pointer events and the textarea covers it, so
    // a span can never receive :hover — the pointer is hit-tested against the
    // span rectangles instead. getClientRects (plural) so a span broken across
    // two lines is matched on the fragment actually under the pointer.
    const handleFieldMouseMove = (e) => {
        const field = fieldRef.current;
        // Measuring rectangles forces a layout, so untagged rows — most of them,
        // on a partly annotated dataset — skip the work entirely.
        if (!field || spans.length === 0) return;
        // Mid-drag the pointer is selecting text, not inspecting a span.
        if (e.buttons !== 0) {
            if (hoveredRef.current !== null) clearHover();
            return;
        }

        let match = null;
        for (const mark of field.querySelectorAll("[data-span]")) {
            for (const rect of mark.getClientRects()) {
                if (e.clientX >= rect.left && e.clientX <= rect.right
                    && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    match = { index: Number(mark.dataset.span), rect };
                    break;
                }
            }
            if (match) break;
        }

        const index = match ? match.index : null;
        if (index === hoveredRef.current) return;
        hoveredRef.current = index;

        const span = match ? segments[match.index]?.span : null;
        if (!span) {
            setHovered(null);
            return;
        }
        const bounds = field.getBoundingClientRect();
        const clipper = scrollParentOf(field);
        // Flip below when the label would be cut off by the scrolling list.
        const ceiling = clipper ? clipper.getBoundingClientRect().top : 0;
        const below = match.rect.top - ceiling < TIP_CLEARANCE;
        setHovered({
            label: span.label,
            left: match.rect.left - bounds.left + match.rect.width / 2,
            top: (below ? match.rect.bottom : match.rect.top) - bounds.top,
            below
        });
    };

    const handlePick = async (entity) => {
        const { start, end } = picker;
        setPicker(null);
        // A pending text edit has to land first: the offsets were measured
        // against the edited text, so the server has to be holding that same
        // text before the span is applied on top of it.
        if (edit && !(await commit())) return;
        onAnnotate(utterance.id, { entity_id: entity.id, start, end });
    };

    return (
        <ListGroup.Item className="py-2 utterance-row">
            <div className="d-flex align-items-center gap-2">
                <div className="text-muted small font-monospace" style={{ minWidth: "2rem", textAlign: "right" }}>
                    {number}.
                </div>
                <div
                    ref={fieldRef}
                    className="utterance-field flex-grow-1"
                    style={{ minWidth: 0 }}
                    onBlur={handleFieldBlur}
                    onMouseMove={handleFieldMouseMove}
                    onMouseLeave={clearHover}
                >
                    {/* Sits in flow and so sets the field's height; the textarea
                        stretches over it. Both share their typography exactly —
                        change one and the highlights stop lining up. */}
                    <div className="utterance-layer">
                        {segments.map((segment, index) => segment.span ? (
                            <mark
                                key={index}
                                className="utterance-span"
                                data-span={index}
                                style={{
                                    backgroundColor: segment.span.color,
                                    color: readableTextColor(segment.span.color),
                                    // Two offset copies rather than a spread: this
                                    // pads the highlight vertically without widening
                                    // it, so the space between two adjacent spans
                                    // stays visible (a spread eats it from both
                                    // sides and they read as one block).
                                    boxShadow: `0 2px 0 0 ${segment.span.color}, 0 -2px 0 0 ${segment.span.color}`
                                }}
                            >
                                {segment.text}
                            </mark>
                        ) : (
                            <span key={index}>{segment.text}</span>
                        ))}
                        {/* Keeps the layer a full line tall when the row is empty,
                            so the textarea over it never collapses. */}
                        {"​"}
                    </div>
                    {hovered && (
                        // Names the span under the pointer. Outside the layer so
                        // the layer keeps mirroring the textarea character for
                        // character, and inert so it never eats a click meant for
                        // the text beneath it.
                        <span
                            className={`utterance-tip${hovered.below ? " utterance-tip-below" : ""}`}
                            style={{ left: hovered.left, top: hovered.top }}
                        >
                            {hovered.label}
                        </span>
                    )}
                    <textarea
                        ref={inputRef}
                        className="utterance-input"
                        value={text}
                        rows={1}
                        spellCheck={false}
                        aria-label={`Utterance ${number}`}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onMouseUp={handleSelection}
                        onKeyUp={handleSelection}
                    />
                    {picker && (
                        <div data-entity-picker onMouseDown={(e) => e.preventDefault()}>
                            <EntityPicker
                                entities={entities}
                                suggestedName={suggestions[picker.value.toLowerCase()]}
                                onPick={handlePick}
                                onClose={() => setPicker(null)}
                                style={{ left: 0, top: "100%", marginTop: 4 }}
                                maxWidth={280}
                            />
                        </div>
                    )}
                </div>
                {showIntent && (
                    // Read-only intent context while tagging slots; set or
                    // change it in the Intents tab.
                    <Link
                        to={`/models/${modelId}/build?tab=intents`}
                        className="text-decoration-none flex-shrink-0"
                        title={utterance.intent
                            ? `Intent: ${utterance.intent.name} — change it in the Intents tab`
                            : "No intent — set one in the Intents tab"}
                    >
                        <Badge
                            bg={utterance.intent ? undefined : "warning-subtle"}
                            text={utterance.intent ? undefined : "warning-emphasis"}
                            className="border fw-normal"
                            style={utterance.intent ? {
                                backgroundColor: utterance.intent.color,
                                color: readableTextColor(utterance.intent.color)
                            } : undefined}
                        >
                            {utterance.intent ? utterance.intent.name : "no intent"}
                        </Badge>
                    </Link>
                )}
                <Badge
                    bg="secondary-subtle"
                    text="muted"
                    className="border fw-normal font-monospace flex-shrink-0"
                    title={`${spans.length} annotated span${spans.length === 1 ? "" : "s"}`}
                >
                    {spans.length}
                </Badge>
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
            {/* Revealed by CSS on focus, so it costs no render mid-edit. */}
            <div className="utterance-hint text-muted mt-1" style={{ marginLeft: "2.5rem", fontSize: "0.7rem" }}>
                select a phrase to tag it · editing a tagged phrase clears its tag · Enter saves, Esc reverts
            </div>
            {showTags && (
                <div className="mt-2" style={{ marginLeft: "2.5rem" }}>
                    <TokenTags query={utterance.text} tags={tags} colorOf={colorOf} />
                </div>
            )}
        </ListGroup.Item>
    );
};

export default AnnotatedUtterance;
