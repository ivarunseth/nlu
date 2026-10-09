// The inline "{entity: value}" authoring markup, shared by the annotation
// workspace's create box and its in-place editor so typed and edited markup
// parse identically. Kept in sync with the server's parser in server/tagging.py
// so the client preview never diverges from what a model trains on.

// Parses inline markup into plain text plus character-offset spans. Leftover
// braces are reported rather than stored.
export const parseInline = (raw) => {
    const spans = [];
    let text = "";
    let last = 0;
    for (const match of raw.matchAll(/\{\s*([^{}:]+?)\s*:\s*([^{}]*?)\s*\}/g)) {
        text += raw.slice(last, match.index);
        const value = match[2];
        if (value) {
            spans.push({ entity: match[1], start: text.length, end: text.length + value.length });
            text += value;
        }
        last = match.index + match[0].length;
    }
    text += raw.slice(last);
    const error = /[{}]/.test(text) ? "Annotation markup has unbalanced braces." : null;
    return { text, spans, error };
};

// Renders text with its annotations wrapped back into "{entity: value}" markup,
// the inverse of parseInline. Used to seed the in-place editor so existing
// spans show as editable markup. `annotations` are the utterance's spans, each
// with a `label` (entity name), `start` and `end`.
export const formatInline = (text = "", annotations = []) => {
    const spans = [...annotations].sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    spans.forEach((annotation) => {
        out += text.slice(cursor, annotation.start);
        out += `{${annotation.label}: ${text.slice(annotation.start, annotation.end)}}`;
        cursor = annotation.end;
    });
    out += text.slice(cursor);
    return out;
};
