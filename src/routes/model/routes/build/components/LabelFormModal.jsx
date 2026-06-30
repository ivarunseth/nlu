import { Button, Form, InputGroup, Modal, Spinner } from "react-bootstrap";

const LabelFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    dataset,
    header,
    onHide,
    onSubmit,
    onNameChange,
    onDatasetChange,
    onHeaderChange
}) => (
    <Modal centered show={show} onHide={onHide}>
        <Modal.Header closeButton>
            <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
            <Form noValidate validated={validated} onSubmit={onSubmit}>
                <Form.Group className="mb-3">
                    <Form.Label>Name</Form.Label>
                    <InputGroup hasValidation>
                        <Form.Control
                            type="text"
                            placeholder="Enter a name..."
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            autoFocus
                            required
                        />
                        <Form.Control.Feedback type="invalid">
                            Please enter a name.
                        </Form.Control.Feedback>
                    </InputGroup>
                    <Form.Text muted>
                        Choose a unique name for the label.
                    </Form.Text>
                </Form.Group>
                <Form.Group className="mb-3">
                    <Form.Label>Dataset</Form.Label>
                    <Form.Control
                        type="file"
                        onChange={(e) => onDatasetChange(e.target.files[0])}
                    />
                    <Form.Text muted>
                        You can optionally upload a dataset containing comma or tab separated text and labels.
                    </Form.Text>
                </Form.Group>
                <Form.Group className="mb-3">
                    <Form.Check
                        type="checkbox"
                        label="contains header"
                        disabled={!dataset}
                        onChange={(e) => onHeaderChange(e.target.checked)}
                        checked={header}
                    />
                    <Form.Text muted>
                        Check only if the dataset contains a header with column names.
                    </Form.Text>
                </Form.Group>
                <div className="d-grid gap-2">
                    <Button type="submit" variant="primary" disabled={submitting}>
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

export default LabelFormModal;
