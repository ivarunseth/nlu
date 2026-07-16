import { Button, ButtonGroup, Col, Form, InputGroup, Modal, Row, Spinner, ToggleButton } from "react-bootstrap";

// `listType`/`onListTypeChange` are optional: the modal doubles as the slot
// form on legacy surfaces, and slots carry no value-space type — the
// open/closed choice renders only when the caller manages entities.
const EntityFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    color,
    description,
    listType,
    onHide,
    onSubmit,
    onNameChange,
    onColorChange,
    onDescriptionChange,
    onListTypeChange
}) => (
    <Modal centered show={show} onHide={onHide}>
        <Modal.Header closeButton>
            <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
            <Form noValidate validated={validated} onSubmit={onSubmit}>
                <Form.Group className="mb-3">
                    <Row className="g-2">
                        <Col>
                            <InputGroup hasValidation>
                                <Form.Floating>
                                    <Form.Control
                                        id="entity-name"
                                        type="text"
                                        placeholder="Enter a name..."
                                        value={name}
                                        onChange={(e) => onNameChange(e.target.value)}
                                        pattern="\S+"
                                        autoFocus
                                        required
                                    />
                                    <Form.Label htmlFor="entity-name">Name</Form.Label>
                                    <Form.Control.Feedback type="invalid">
                                        Please enter a name without spaces.
                                    </Form.Control.Feedback>
                                </Form.Floating>
                            </InputGroup>
                        </Col>
                        <Col xs="auto">
                            <Form.Control
                                type="color"
                                id="entity-color"
                                title="Highlight colour"
                                aria-label="Highlight colour"
                                value={color}
                                onChange={(e) => onColorChange(e.target.value)}
                                className="h-100"
                                style={{ width: "58px" }}
                            />
                        </Col>
                    </Row>
                    <Form.Text muted>
                        Entity names become IOB tag suffixes, so they cannot contain spaces.
                        The colour highlights this entity's spans.
                    </Form.Text>
                </Form.Group>
                {onListTypeChange && (
                    <Form.Group className="mb-3">
                        <ButtonGroup className="w-100">
                            {[
                                { value: "open", label: "Open list" },
                                { value: "closed", label: "Closed list" }
                            ].map((option) => (
                                <ToggleButton
                                    key={option.value}
                                    id={`entity-list-type-${option.value}`}
                                    type="radio"
                                    variant="outline-secondary"
                                    size="sm"
                                    name="entity-list-type"
                                    value={option.value}
                                    checked={(listType || "open") === option.value}
                                    onChange={(e) => onListTypeChange(e.currentTarget.value)}
                                >
                                    {option.label}
                                </ToggleButton>
                            ))}
                        </ButtonGroup>
                        <Form.Text muted>
                            {(listType || "open") === "closed"
                                ? "A finite, manageable set of values (coffee_type, device_type) — training enumerates the value catalogue."
                                : "Not enumerable (person, place) — training also generalizes to unseen values with UNK variants."}
                        </Form.Text>
                    </Form.Group>
                )}
                <Form.Group className="mb-3">
                    <Form.Floating>
                        <Form.Control
                            id="entity-description"
                            as="textarea"
                            placeholder="Enter a description..."
                            value={description}
                            onChange={(e) => onDescriptionChange(e.target.value)}
                            style={{ height: "100px" }}
                        />
                        <Form.Label htmlFor="entity-description">Description</Form.Label>
                    </Form.Floating>
                    <Form.Text muted>
                        Optional annotation guideline, shown when hovering the entity.
                    </Form.Text>
                </Form.Group>
                <div className="d-grid gap-2">
                    <Button type="submit" variant="light" className="border" disabled={submitting}>
                        {submitting ? (
                            <>
                                <Spinner animation="border" size="sm" />
                                &nbsp;
                                Submitting...
                            </>
                        ) : (
                            "Submit"
                        )}
                    </Button>
                </div>
            </Form>
        </Modal.Body>
    </Modal>
);

export default EntityFormModal;
