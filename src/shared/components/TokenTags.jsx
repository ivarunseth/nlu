import { Badge } from "react-bootstrap";
import { entityColor, readableTextColor } from "./entityColors";

// The entity name carried by an IOB tag ("B-location"/"I-location" -> "location"),
// or null for "O" and malformed tags.
const entityOf = (tag) => (tag && (tag.startsWith("B-") || tag.startsWith("I-")) ? tag.slice(2) : null);

// One chip per whitespace token pairing the token with its IOB tag. Shared by
// the Test page's prediction views and Build's annotation tag preview, so the
// two surfaces read the same. Each B-/I- chip is coloured with its entity's
// colour so the tag sequence speaks the same colour language as the highlighted
// spans; `colorOf` maps an entity name to a colour. Both Test and Build pass the
// entity's assigned (stored) colour, so an IOB tag matches the colour its entity
// was given in Build; it defaults to the deterministic name-based palette for
// any name without a stored colour. Falls back to tag-only chips when the token
// count does not match the tag count.
const TokenTags = ({ query, tags, colorOf = entityColor }) => {
    const tokens = (query || "").trim().split(/\s+/).filter(Boolean);
    const aligned = tokens.length === tags.length;
    const items = aligned ? tokens.map((token, index) => ({ token, tag: tags[index] })) : tags.map((tag) => ({ token: null, tag }));
    return (
        <div className="d-flex flex-wrap gap-2">
            {items.map((item, index) => {
                const entity = entityOf(item.tag);
                const color = entity ? colorOf(entity) : null;
                return (
                    <div key={index} className="border border-light-subtle rounded text-center bg-body" style={{ minWidth: "60px" }}>
                        {item.token !== null && (
                            <div className="px-2 py-1 border-bottom border-light-subtle small fw-medium text-break">{item.token}</div>
                        )}
                        <div className="px-2 py-1">
                            {color ? (
                                <span
                                    className="badge font-monospace fw-normal"
                                    style={{ backgroundColor: color, color: readableTextColor(color) }}
                                >
                                    {item.tag}
                                </span>
                            ) : (
                                <Badge bg="secondary-subtle" text="muted" className="font-monospace fw-normal">
                                    {item.tag}
                                </Badge>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default TokenTags;
