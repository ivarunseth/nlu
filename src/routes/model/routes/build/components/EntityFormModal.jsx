import { Button, Col, Form, InputGroup, Modal, Row, Spinner } from "react-bootstrap";

const EntityFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    color,
    description,
    onHide,
    onSubmit,
    onNameChange,
    onColorChange,
    onDescriptionChange
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
