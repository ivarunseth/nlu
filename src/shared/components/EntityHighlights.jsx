import { Fragment } from "react";
import { entityColor, readableTextColor } from "./entityColors";

// Read-only render of a prediction's entity spans over their source text, sharing
// the colour language of Build's annotation workspace. Each span is shown as a
// solid-colour pill (the entity's colour as background, auto black/white text)
// carrying the matched value and its entity name — the same badge style as Build's
// annotation chips, minus the remove control. Used by Test to show a prediction's
// { entities: [{ entity, value, start, end, score }] } over the query. `colorOf`
// maps an entity name to a colour; Test passes each entity's assigned (stored)
// colour so a highlight matches the colour it was given in Build, defaulting to
// the deterministic name-based palette for any name without a stored colour.
const EntityHighlights = ({ text = "", entities = [], colorOf = entityColor }) => {
    // Keep only well-formed, in-bounds spans and lay them out left to right,
    // skipping any that overlap one already placed (flat NER only).
    const spans = [...entities]
        .filter((entity) =>
            Number.isInteger(entity.start) &&
            Number.isInteger(entity.end) &&
            entity.start < entity.end &&
            entity.end <= text.length
        )
        .sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0;
    spans.forEach((entity) => {
        if (entity.start < cursor) return;
        if (entity.start > cursor) segments.push({ text: text.slice(cursor, entity.start) });
        segments.push({ text: text.slice(entity.start, entity.end), entity });
        cursor = entity.end;
    });
    if (cursor < text.length || segments.length === 0) {
        segments.push({ text: text.slice(cursor) });
    }

    return (
        <div className="text-break" style={{ lineHeight: 2.2 }}>
            {segments.map((segment, index) => {
                if (!segment.entity) return <span key={index}>{segment.text}</span>;
                const color = colorOf(segment.entity.entity);
                const textColor = readableTextColor(color);
                return (
                    <span
                        key={index}
                        className="badge rounded-pill ms-1 me-1 px-2 py-1 align-middle fw-normal"
                        style={{ backgroundColor: color, color: textColor, fontSize: "0.8rem" }}
                        title={typeof segment.entity.score === "number" ? `${segment.entity.entity} ${(segment.entity.score * 100).toFixed(1)}%` : segment.entity.entity}
                    >
                        {segment.text}
                    </span>
                );
            })}
        </div>
    );
};

export default EntityHighlights;
