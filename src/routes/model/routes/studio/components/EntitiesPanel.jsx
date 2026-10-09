import { Card, Spinner } from "react-bootstrap";
import { InfoCircle, Pen, Search, Tags, XLg } from "react-bootstrap-icons";
import { Link } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

// Colour swatch shared by the entity chips and the annotation popover.
export const EntityDot = ({ color }) => (
    <span
        className="d-inline-block rounded-circle flex-shrink-0"
        style={{ width: "10px", height: "10px", backgroundColor: color || "var(--bs-secondary)" }}
    />
);

// The entity registry of a named entity recognition model — or, retitled,
// the slot registry of a language understanding one: one chip per row with its
// colour, span count and edit/delete actions. `titleOf`
// overrides the chip's hover title (defaults to the row's description);
// `linkOf` turns the chip's name into a drill-in link (the value catalogue).
const EntitiesPanel = ({
    loading,
    entities,
    query,
    onEdit,
    onDelete,
    noun = "entity",
    linkOf,
    titleOf = (entity) => entity.description || undefined
}) => {
    const visible = query
        ? entities.filter((entity) => entity.name.toLowerCase().includes(query.toLowerCase()))
        : entities;
    const plural = noun === "entity" ? "entities" : `${noun}s`;

    return (
        <Card className="border-light overflow-hidden h-100">
            <CardHeading
                icon={<Tags />}
                title={`${plural.charAt(0).toUpperCase()}${plural.slice(1)}`}
                right={
                    <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                        {entities.length} {entities.length === 1 ? noun : plural}
                    </span>
                }
            />
            <Card.Body className="p-3 overflow-auto no-scrollbar" style={{ minHeight: "50vh", maxHeight: "50vh" }}>
                {loading ? (
                    <div className="d-flex justify-content-center py-3">
                        <Spinner animation="border" />
                    </div>
                ) : visible.length > 0 ? (
                    <div className="d-flex flex-wrap gap-2 align-content-start">
                        {visible.map((entity) => (
                            <span
                                key={entity.id}
                                className="border rounded-pill bg-body d-inline-flex align-items-center gap-2 px-3 py-1 flex-wrap" style={{maxWidth:"100%"}}
                                title={titleOf(entity)}
                            >
                                <EntityDot color={entity.color} />
                                {linkOf ? (
                                    <Link
                                        to={linkOf(entity)}
                                        className="fw-medium small text-break text-truncate text-decoration-none"
                                        style={{ maxWidth: "120px" }}
                                        title={`Open ${entity.name}'s value catalogue`}
                                    >
                                        {entity.name}
                                    </Link>
                                ) : (
                                    <span className="fw-medium small text-break text-truncate" style={{maxWidth:"120px"}}>{entity.name}</span>
                                )}
                                <span className="text-muted font-monospace" style={{ fontSize: "var(--app-text-xs)" }}>
                                    {entity.annotations_count}
                                </span>
                                <Pen
                                    role="button"
                                    aria-label={`Edit ${entity.name}`}
                                    className="text-muted"
                                    size={12}
                                    onClick={() => onEdit(entity)}
                                />
                                <XLg
                                    role="button"
                                    aria-label={`Delete ${entity.name}`}
                                    className="text-danger"
                                    size={12}
                                    onClick={() => onDelete(entity)}
                                />
                            </span>
                        ))}
                    </div>
                ) : query !== "" ? (
                    <EmptyMessage icon={<Search />}>
                        could not find the {noun} you are looking for.
                    </EmptyMessage>
                ) : (
                    <EmptyMessage icon={<InfoCircle />}>
                        define your first {noun} to start annotating spans.
                    </EmptyMessage>
                )}
            </Card.Body>
        </Card>
    );
};

export default EntitiesPanel;
        