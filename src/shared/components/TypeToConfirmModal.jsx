import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { ExclamationTriangleFill } from "react-bootstrap-icons";

// A destructive-action confirmation that forces the user to type an exact
// phrase (default "delete") before the confirm button unlocks — the guard
// used for irreversible actions like deleting a model. The typed value is
// reset every time the modal opens so a prior confirmation can't carry over.
//
// Colours come from Bootstrap 5.3 semantic tokens rather than fixed values so
// the modal follows data-bs-theme without a second set of dark-mode rules.
const TypeToConfirmModal = ({
    show,
    title = "Confirm deletion",
    confirmWord = "delete",
    confirmLabel = "Delete",
    submitting = false,
    error = null,
    onHide,
    onConfirm,
    children
}) => {
    const [typed, setTyped] = useState("");

    useEffect(() => {
        if (show) setTyped("");
    }, [show]);

    const matched = typed.trim().toLowerCase() === confirmWord.toLowerCase();

    return (
        <Modal
            centered
            show={show}
            onHide={submitting ? undefined : onHide}
            aria-labelledby="type-to-confirm-title"
        >
            <Form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (matched && !submitting) onConfirm();
                }}
            >
                <Modal.Body className="text-center px-4 pt-4 pb-3">
                    <div
                        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-danger-subtle text-danger-emphasis mb-3"
                        style={{ width: "3.5rem", height: "3.5rem" }}
                        aria-hidden="true"
                    >
                        <ExclamationTriangleFill size={24} />
                    </div>
                    <h5 id="type-to-confirm-title" className="fw-semibold mb-2">
                        {title}
                    </h5>
                    <div className="text-body-secondary">{children}</div>
                    {error && (
                        <Alert variant="danger" className="small text-start py-2 mt-3 mb-0">
                            {error}
                        </Alert>
                    )}
                    {/* The field is left-aligned even inside the centered
                        composition: a centered text input reads as decoration
                        rather than something to type into. */}
                    <Form.Group className="text-start mt-3">
                        <Form.Label className="small text-body-secondary">
                            Type <span className="fw-semibold text-danger">{confirmWord}</span> to confirm
                        </Form.Label>
                        <Form.Control
                            type="text"
                            autoFocus
                            autoComplete="off"
                            value={typed}
                            placeholder={confirmWord}
                            disabled={submitting}
                            onChange={(event) => setTyped(event.target.value)}
                        />
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer className="border-0 d-flex gap-2 px-4 pb-4 pt-0">
                    <Button
                        variant="light"
                        className="border flex-fill m-0"
                        disabled={submitting}
                        onClick={onHide}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="danger"
                        className="flex-fill m-0 d-inline-flex align-items-center justify-content-center gap-2"
                        disabled={!matched || submitting}
                    >
                        {submitting && <Spinner animation="border" size="sm" />}
                        {confirmLabel}
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
};

export default TypeToConfirmModal;
