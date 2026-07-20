import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { ExclamationTriangleFill } from "react-bootstrap-icons";

// A destructive-action confirmation that forces the user to type an exact
// phrase (default "delete") before the confirm button unlocks — the guard
// used for irreversible actions like deleting a model. The typed value is
// reset every time the modal opens so a prior confirmation can't carry over.
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
        <Modal centered show={show} onHide={submitting ? undefined : onHide}>
            <Modal.Header closeButton={!submitting}>
                <Modal.Title className="small fw-bold text-danger d-inline-flex align-items-center gap-2">
                    <ExclamationTriangleFill /> {title}
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {children}
                {error && <Alert variant="danger" className="small py-2">{error}</Alert>}
                <Form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (matched && !submitting) onConfirm();
                    }}
                >
                    <Form.Group className="mb-3">
                        <Form.Label className="small">
                            Type <span className="fw-bold text-danger">{confirmWord}</span> to confirm.
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
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" className="border small" disabled={submitting} onClick={onHide}>
                            CANCEL
                        </Button>
                        <Button
                            type="submit"
                            variant="danger"
                            size="sm"
                            className="small d-inline-flex align-items-center gap-2"
                            disabled={!matched || submitting}
                        >
                            {submitting && <Spinner animation="border" size="sm" />}
                            {confirmLabel.toUpperCase()}
                        </Button>
                    </div>
                </Form>
            </Modal.Body>
        </Modal>
    );
};

export default TypeToConfirmModal;
