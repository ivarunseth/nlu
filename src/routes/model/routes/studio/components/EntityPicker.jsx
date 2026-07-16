import { useEffect, useRef, useState } from "react";
import { Card, Form } from "react-bootstrap";
import { StarFill } from "react-bootstrap-icons";
import { EntityDot } from "./EntitiesPanel";

const EntityPicker = ({
    entities,
    suggestedName,
    onPick,
    onClose,
    style,
    maxWidth,
}) => {
    const [query, setQuery] = useState("");
    const cardRef = useRef(null);

    // Dismiss on a click anywhere outside this popover or on Escape. Because a
    // selection in another row begins with a mousedown outside the open picker,
    // this also guarantees at most one picker is open across the workspace.
    useEffect(() => {
        const handlePointerDown = (event) => {
            if (!cardRef.current?.contains(event.target)) onClose?.();
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    const filtered = query
        ? entities.filter((e) =>
              e.name.toLowerCase().includes(query.toLowerCase())
          )
        : entities;

    const visible = [...filtered].sort(
        (a, b) =>
            (b.name === suggestedName ? 1 : 0) -
            (a.name === suggestedName ? 1 : 0)
    );

    return (
        <Card
            ref={cardRef}
            data-entity-picker
            className="position-absolute shadow-sm border-0"
            style={{
                ...style,
                zIndex: 10,
                minWidth: 220,
                maxWidth,
                borderRadius: 10,
            }}
        >
            {entities.length === 0 ? (
                <div className="text-muted small px-3 py-2">
                    Define an entity first.
                </div>
            ) : (
                <>
                    {entities.length > 6 && (
                        <div className="p-2">
                            <Form.Control
                                size="sm"
                                autoFocus
                                placeholder="Search..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onMouseUp={(e) => e.stopPropagation()}
                            />
                        </div>
                    )}

                    <div
                        className="py-1 no-scrollbar"
                        style={{
                            maxHeight: 240,
                            overflowY: "auto",
                        }}
                    >
                        {visible.length > 0 ? (
                            visible.map((entity) => (
                                <div
                                    key={entity.id}
                                    role="button"
                                    onClick={() => onPick(entity)}
                                    title={
                                        entity.name === suggestedName
                                            ? "Previously used for this phrase"
                                            : undefined
                                    }
                                    className="d-flex align-items-center px-3 py-2 entity-picker-item"
                                >
                                    <EntityDot color={entity.color} />

                                    <span className="ms-2 flex-grow-1 text-truncate">
                                        {entity.name}
                                        {/* {entity.entity && (
                                            // A slot row: show the entity the
                                            // slot maps to beside its role name.
                                            <span className="text-muted small ms-2">
                                                {entity.entity.name}
                                            </span>
                                        )} */}
                                    </span>

                                    {entity.name === suggestedName && (
                                        <StarFill
                                            size={10}
                                            className="text-warning"
                                        />
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="text-muted small px-3 py-2">
                                No matching entity.
                            </div>
                        )}
                    </div>
                </>
            )}
        </Card>
    );
};

export default EntityPicker;