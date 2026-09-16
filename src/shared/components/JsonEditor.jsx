import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretDownFill, CaretRightFill, PlusLg, XLg } from "react-bootstrap-icons";
import "./JsonEditor.css";

// A dependency-free JSON tree editor. Renders a document as syntax-coloured,
// collapsible JSON and lets every leaf be edited in place: click a value to
// get an input, Enter/blur commits, Esc cancels. Arrays grow through a `+`
// row at their head and shrink through a `×` on each item. Keys are fixed — the schema is
// whatever the document arrived with — so callers control the shape through
// `templateFor(path)` (what a new array item looks like) and the leaves
// through `readOnly(path)` / `nullable(path)`.
//
// Controlled: `value` in, `onChange(nextDocument)` out, built with the
// structural-sharing helpers below.
//
// Rendering is virtualised. The tree is flattened into lines — one per
// bracket, leaf or collapsed container — of one fixed height, and only the
// lines inside the scroll window (plus a margin) are in the DOM. That is what
// keeps a 25k-utterance dataset instant to open, scroll and toggle: a
// collapse changes an array of line descriptors, not tens of thousands of
// elements. Collapse state lives here, keyed by path, seeded by
// `startCollapsed(path, value, depth)`.

// --- Immutable path helpers -------------------------------------------------

export const getAt = (doc, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), doc);

export const setAt = (doc, path, value) => {
    if (path.length === 0) return value;
    const [head, ...rest] = path;
    const copy = Array.isArray(doc) ? [...doc] : { ...doc };
    copy[head] = setAt(doc[head], rest, value);
    return copy;
};

export const removeAt = (doc, path) => {
    const parentPath = path.slice(0, -1);
    const key = path[path.length - 1];
    const parent = getAt(doc, parentPath);
    if (Array.isArray(parent)) {
        return setAt(doc, parentPath, parent.filter((_, index) => index !== key));
    }
    const copy = { ...parent };
    delete copy[key];
    return setAt(doc, parentPath, copy);
};

// New items go in at the head: the `+ add` line sits at the top of an array,
// so what it inserts appears right under it, not somewhere below the fold.
export const prependAt = (doc, path, item) => setAt(doc, path, [item, ...getAt(doc, path)]);

// --- Flattening -------------------------------------------------------------

// Line height in px; the CSS mirrors it.
export const LINE_HEIGHT = 22;
const OVERSCAN = 20;

const typeOf = (value) => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
};

// Paths become map keys; the separator is one no key or index can contain.
const keyOf = (path) => path.join("\u0001");

// The one-line stand-in for a collapsed container: for objects the first
// identifying string (name / text / value), so a collapsed row still says
// which record it is; for arrays the length.
const summary = (value) => {
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
    const hint = ["name", "text", "value"].map((key) => value[key]).find((v) => typeof v === "string");
    const keys = Object.keys(value).length;
    const fields = `${keys} field${keys === 1 ? "" : "s"}`;
    return hint !== undefined ? `"${hint}" · ${fields}` : fields;
};

// Walks the document into line descriptors, skipping the insides of
// collapsed containers. Each line knows its path, depth, the key it sits
// under (objects) or whether it is an array item (which gets a ×), and
// whether a comma follows it.
const flatten = (doc, isCollapsed, templateFor) => {
    const lines = [];
    const walk = (value, path, depth, keyName, inArray, isLast) => {
        const type = typeOf(value);
        const base = { path, depth, keyName, inArray, isLast };
        if (type !== "object" && type !== "array") {
            lines.push({ ...base, kind: "leaf", value });
            return;
        }
        const isArray = type === "array";
        if (isCollapsed(path, value, depth)) {
            lines.push({ ...base, kind: "collapsed", value, isArray });
            return;
        }
        lines.push({ ...base, kind: "open", isArray });
        const template = isArray ? templateFor(path) : undefined;
        if (template) lines.push({ kind: "add", path, depth: depth + 1, template });
        const entries = isArray ? value.map((item, index) => [index, item]) : Object.entries(value);
        entries.forEach(([key, child], index) => {
            walk(child, [...path, key], depth + 1, isArray ? null : key, isArray, index === entries.length - 1);
        });
        lines.push({ ...base, kind: "close", isArray });
    };
    walk(doc, [], 0, null, false, true);
    return lines;
};

// --- Leaves -----------------------------------------------------------------

const Leaf = ({ value, path, readOnly, nullable, onCommit }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef(null);
    // Esc unmounts the input, and the browser fires its blur on the way out;
    // the flag keeps that blur from committing the abandoned draft.
    const cancelled = useRef(false);
    const type = typeOf(value);
    const isColor = path[path.length - 1] === "color";

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const start = () => {
        if (readOnly) return;
        if (type === "boolean") {
            onCommit(path, !value);
            return;
        }
        setDraft(value === null ? "" : String(value));
        setEditing(true);
    };

    const commit = () => {
        setEditing(false);
        if (cancelled.current) {
            cancelled.current = false;
            return;
        }
        if (type === "number") {
            const parsed = draft.trim() === "" ? null : Number(draft);
            if (parsed !== null && !Number.isNaN(parsed)) onCommit(path, parsed);
            return;
        }
        if (draft === "" && (value === null || nullable)) {
            onCommit(path, null);
            return;
        }
        onCommit(path, draft);
    };

    const onKeyDown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelled.current = true;
            setEditing(false);
        }
    };

    if (editing) {
        return (
            <span className="je-edit">
                {isColor && (
                    <input
                        type="color"
                        className="je-swatch-input"
                        value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : "#000000"}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Pick colour"
                    />
                )}
                <input
                    ref={inputRef}
                    type={type === "number" ? "number" : "text"}
                    className={`je-input je-${type === "number" ? "number" : "string"}`}
                    value={draft}
                    size={Math.min(Math.max(draft.length + 1, 4), 80)}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={onKeyDown}
                />
            </span>
        );
    }

    let rendered;
    if (type === "string") rendered = <>&quot;{value}&quot;</>;
    else if (type === "null") rendered = "null";
    else rendered = String(value);
    return (
        <span
            className={`je-leaf je-${type}${readOnly ? " je-readonly" : ""}`}
            role={readOnly ? undefined : "button"}
            tabIndex={readOnly ? undefined : 0}
            title={readOnly ? "Read-only" : "Click to edit"}
            onClick={start}
            onKeyDown={(e) => {
                if (!readOnly && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    start();
                }
            }}
        >
            {isColor && type === "string" && (
                <span className="je-swatch" style={{ background: value }} aria-hidden="true" />
            )}
            {rendered}
        </span>
    );
};

// --- Lines ------------------------------------------------------------------

const Guides = ({ depth }) => (
    Array.from({ length: depth }, (_, index) => <span key={index} className="je-guide" aria-hidden="true" />)
);

const Punct = ({ children }) => <span className="je-punct">{children}</span>;

const Line = memo(({ line, readOnly, nullable, onCommit, onRemove, onAppend, onToggle }) => {
    const { kind, path, depth, keyName, inArray, isLast } = line;
    const comma = isLast || kind === "open" || kind === "add" ? null : <Punct>,</Punct>;
    const keyLabel = keyName !== null && keyName !== undefined && kind !== "close" ? (
        <span className="je-key">&quot;{keyName}&quot;<Punct>:</Punct></span>
    ) : null;
    const remove = inArray && kind !== "close" ? (
        <button
            type="button"
            className="je-remove"
            title="Remove item"
            aria-label="Remove item"
            onClick={() => onRemove(path)}
        >
            <XLg />
        </button>
    ) : null;

    let body;
    if (kind === "leaf") {
        body = (
            <>
                <span className="je-caret" />
                {keyLabel}
                <Leaf
                    value={line.value}
                    path={path}
                    readOnly={readOnly(path)}
                    nullable={nullable(path)}
                    onCommit={onCommit}
                />
                {comma}
            </>
        );
    } else if (kind === "add") {
        body = (
            <>
                <span className="je-caret" />
                <button type="button" className="je-add" onClick={() => onAppend(path, line.template.item)}>
                    <PlusLg /> add {line.template.noun}
                </button>
            </>
        );
    } else if (kind === "close") {
        body = (
            <>
                <span className="je-caret" />
                <Punct>{line.isArray ? "]" : "}"}</Punct>
                {comma}
            </>
        );
    } else {
        const [open, close] = line.isArray ? ["[", "]"] : ["{", "}"];
        const collapsed = kind === "collapsed";
        body = (
            <>
                <button
                    type="button"
                    className="je-caret je-toggle"
                    onClick={() => onToggle(path)}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? "Expand" : "Collapse"}
                >
                    {collapsed ? <CaretRightFill /> : <CaretDownFill />}
                </button>
                {keyLabel}
                {collapsed ? (
                    <span
                        className="je-punct je-summary"
                        role="button"
                        tabIndex={0}
                        onClick={() => onToggle(path)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onToggle(path);
                            }
                        }}
                    >
                        {open} <span className="je-hint">{summary(line.value)}</span> {close}
                    </span>
                ) : (
                    <Punct>{open}</Punct>
                )}
                {comma}
            </>
        );
    }

    return (
        <div className="je-line">
            <span className="je-gutter">{remove}</span>
            <Guides depth={depth} />
            {body}
        </div>
    );
});
Line.displayName = "JsonLine";

// --- Root -------------------------------------------------------------------

const never = () => false;
const none = () => undefined;
const records = (path, value, depth) => depth === 2;

const JsonEditor = ({
    value,
    onChange,
    readOnly = never,
    nullable = never,
    templateFor = none,
    startCollapsed = records,
    className = "",
    style
}) => {
    // Handlers close over the latest document via refs so the memoised
    // lines get stable callbacks.
    const docRef = useRef(value);
    docRef.current = value;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Collapse overrides by path key; anything unlisted follows startCollapsed.
    const [overrides, setOverrides] = useState(() => new Map());
    const startCollapsedRef = useRef(startCollapsed);
    startCollapsedRef.current = startCollapsed;

    const lines = useMemo(() => {
        const isCollapsed = (path, node, depth) => {
            const override = overrides.get(keyOf(path));
            return override !== undefined ? override : startCollapsedRef.current(path, node, depth);
        };
        return flatten(value, isCollapsed, templateFor);
    }, [value, overrides, templateFor]);

    const handlers = useRef({
        commit: (path, next) => onChangeRef.current(setAt(docRef.current, path, next)),
        remove: (path) => onChangeRef.current(removeAt(docRef.current, path)),
        append: (path, item) => onChangeRef.current(prependAt(docRef.current, path, item))
    }).current;
    const toggle = useCallback((path) => {
        setOverrides((previous) => {
            const next = new Map(previous);
            const key = keyOf(path);
            const node = getAt(docRef.current, path);
            const current = previous.has(key) ? previous.get(key) : startCollapsedRef.current(path, node, path.length);
            next.set(key, !current);
            return next;
        });
    }, []);

    // The scroll window: which lines are on screen, from the container's
    // scroll offset and height, both tracked without re-rendering per pixel.
    const scrollRef = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState(0);
    const frame = useRef(0);

    const onScroll = () => {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
        });
    };

    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element) return undefined;
        const measure = () => setViewport(element.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (frame.current) cancelAnimationFrame(frame.current);
        };
    }, []);

    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const end = Math.min(lines.length, Math.ceil((scrollTop + viewport) / LINE_HEIGHT) + OVERSCAN);
    const visible = lines.slice(start, end);

    return (
        <div ref={scrollRef} className={`je ${className}`.trim()} style={style} onScroll={onScroll}>
            <div className="je-canvas" style={{ height: lines.length * LINE_HEIGHT }}>
                <div style={{ transform: `translateY(${start * LINE_HEIGHT}px)` }}>
                    {visible.map((line) => (
                        <Line
                            key={`${line.kind}:${keyOf(line.path)}`}
                            line={line}
                            readOnly={readOnly}
                            nullable={nullable}
                            onCommit={handlers.commit}
                            onRemove={handlers.remove}
                            onAppend={handlers.append}
                            onToggle={toggle}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default JsonEditor;
