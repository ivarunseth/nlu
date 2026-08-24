import { Col, Form, InputGroup, Row } from "react-bootstrap";
import FormModal from "../../../../../shared/components/FormModal";

// Marker value for the entity select's "define a new entity" choice.
export const NEW_ENTITY = "__new__";

// Create/edit form for a slot: an intent-scoped role that maps to exactly
// one entity. The entity is chosen from the model's global registry, or
// defined on the fly (IN-3) by picking "New entity…" and naming it — the
// parent creates the entity first, then the slot pointing at it. Slot names
// become IOB tags, so they cannot contain whitespace.
const SlotFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    entities,
    entityId,
    newEntityName,
    onHide,
    onSubmit,
    onNameChange,
    onEntityChange,
    onNewEntityNameChange
}) => (
    <FormModal
        show={show}
        title={title}
        validated={validated}
        submitting={submitting}
        onHide={onHide}
        onSubmit={onSubmit}
    >
        <Form.Group className="mb-3">
            <InputGroup hasValidation>
                <Form.Floating>
                    <Form.Control
                        id="slot-name"
                        type="text"
                        placeholder="Enter a name..."
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        pattern="\S+"
                        autoFocus
                        required
                    />
                    <Form.Label htmlFor="slot-name">Name</Form.Label>
                    <Form.Control.Feedback type="invalid">
                        Please enter a name without spaces.
                    </Form.Control.Feedback>
                </Form.Floating>
            </InputGroup>
            <Form.Text muted>
                The role this span plays in the intent (e.g. source, destination).
                Slot names become IOB tags, so they cannot contain spaces and must
                be unique across the model.
            </Form.Text>
        </Form.Group>
        <Form.Group>
            <Row className="g-2">
                <Col>
                    <Form.Floating>
                        <Form.Select
                            id="slot-entity"
                            value={entityId}
                            onChange={(e) => onEntityChange(e.target.value)}
                            required
                        >
                            <option value="" disabled>Choose an entity...</option>
                            {entities.map((entity) => (
                                <option key={entity.id} value={entity.id}>{entity.name}</option>
                            ))}
                            <option value={NEW_ENTITY}>New entity…</option>
                        </Form.Select>
                        <Form.Label htmlFor="slot-entity">Entity</Form.Label>
                    </Form.Floating>
                </Col>
                {entityId === NEW_ENTITY && (
                    <Col>
                        <Form.Floating>
                            <Form.Control
                                id="slot-new-entity"
                                type="text"
                                placeholder="New entity name..."
                                value={newEntityName}
                                onChange={(e) => onNewEntityNameChange(e.target.value)}
                                pattern="\S+"
                                required
                            />
                            <Form.Label htmlFor="slot-new-entity">New entity name</Form.Label>
                            <Form.Control.Feedback type="invalid">
                                Please enter a name without spaces.
                            </Form.Control.Feedback>
                        </Form.Floating>
                    </Col>
                )}
            </Row>
            <Form.Text muted>
                The reusable type this role is filled with (e.g. location). Several
                slots in one intent may share an entity.
            </Form.Text>
        </Form.Group>
    </FormModal>
);

export default SlotFormModal;
