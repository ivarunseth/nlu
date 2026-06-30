import { Button, Form, InputGroup, Modal, Spinner } from "react-bootstrap";

const ModelFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    type,
    dataset,
    header,
    description,
    showType = false,
    onHide,
    onSubmit,
    onNameChange,
    onTypeChange,
    onDatasetChange,
    onHeaderChange,
    onDescriptionChange
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
                        Choose a unique name for your model.
                    </Form.Text>
                </Form.Group>
                {showType && (
                    <Form.Group className="mb-3">
                        <Form.Label>Type</Form.Label>
                        <Form.Select value={type} onChange={(e) => onTypeChange(e.target.value)}>
                            <option value="text_classification">Text classification</option>
                            <option value="token_classification">Token classification</option>
                            <option value="language_understanding">Language understanding</option>
                        </Form.Select>
                        <Form.Text muted>
                            Select the type that matches the model you want to create.
                        </Form.Text>
                    </Form.Group>
                )}
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
                <Form.Group className="mb-3">
                    <Form.Label>Description</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={3}
                        placeholder="Enter a description..."
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                    />
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

export default ModelFormModal;
