import { Card, Spinner } from "react-bootstrap";
import { InfoCircle, Pen, Search, Tags, XLg } from "react-bootstrap-icons";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

// Colour swatch shared by the entity chips and the annotation popover.
export const EntityDot = ({ color }) => (
    <span
        className="d-inline-block rounded-circle flex-shrink-0"
        style={{ width: "10px", height: "10px", backgroundColor: color || "var(--bs-secondary)" }}
    />
);

// The entity registry of a named entity recognition model: one chip per
// entity (a Label row) with its colour, span count and edit/delete actions.
const EntitiesPanel = ({ loading, entities, query, onEdit, onDelete }) => {
    const visible = query
        ? entities.filter((entity) => entity.name.toLowerCase().includes(query.toLowerCase()))
        : entities;

    return (
        <Card className="border-light overflow-hidden h-100">
            <CardHeading
                icon={<Tags />}
                title="Entities"
                right={
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                        {entities.length} entit{entities.length === 1 ? "y" : "ies"}
                    </span>
                }
            />
            <Card.Body className="p-3 overflow-auto" style={{ minHeight: "50vh", maxHeight: "50vh" }}>
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
                                title={entity.description || undefined}
                            >
                                <EntityDot color={entity.color} />
                                <span className="fw-medium small text-break text-truncate" style={{maxWidth:"120px"}}>{entity.name}</span>
                                <span className="text-muted font-monospace" style={{ fontSize: "0.7rem" }}>
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
                        could not find the entity you are looking for.
                    </EmptyMessage>
                ) : (
                    <EmptyMessage icon={<InfoCircle />}>
                        define your first entity to start annotating spans.
                    </EmptyMessage>
                )}
            </Card.Body>
        </Card>
    );
};

export default EntitiesPanel;
        