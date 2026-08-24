import { Button, Modal, Spinner } from "react-bootstrap";
import { Trash3 } from "react-bootstrap-icons";

// Confirmation for destructive actions that are reversible only by re-entering
// the data. Callers bake the consequence into each item string — e.g.
// "greeting (removes 12 utterances and their slot annotations)" — so the list
// is rendered verbatim rather than being summarised here.
//
// Colours come from Bootstrap 5.3 semantic tokens rather than fixed values so
// the modal follows data-bs-theme without a second set of dark-mode rules.
const DeleteConfirmationModal = ({
    show,
    title,
    items = [],
    itemType,
    submitting,
    onHide,
    onDelete
}) => (
    <Modal
        centered
        show={show}
        // Closing mid-request would strand the caller's submitting state.
        onHide={submitting ? undefined : onHide}
        aria-labelledby="delete-confirmation-title"
    >
        <Modal.Body className="text-center px-4 pt-4 pb-3">
            <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle bg-danger-subtle text-danger-emphasis mb-3"
                style={{ width: "3.5rem", height: "3.5rem" }}
                aria-hidden="true"
            >
                <Trash3 size={24} />
            </div>
            <h5 id="delete-confirmation-title" className="fw-semibold mb-2">
                {title}
            </h5>
            <p className="text-body-secondary mb-3">
                {items.length > 1
                    ? `These ${items.length} ${itemType}s will be permanently deleted.`
                    : `This ${itemType} will be permanently deleted.`}
                {" "}This cannot be undone.
            </p>
            {/* Each entry sits on its own line: the consequence suffixes the
                callers append are too long to read inline or inside quotes. */}
            <ul
                className="list-unstyled text-start small text-body-secondary bg-body-secondary rounded p-3 mb-0"
                style={{ maxHeight: "10rem", overflowY: "auto" }}
            >
                {items.map((name) => (
                    <li key={name} className="text-break">{name}</li>
                ))}
            </ul>
        </Modal.Body>
        <Modal.Footer className="border-0 d-flex gap-2 px-4 pb-4 pt-0">
            <Button
                variant="light"
                className="border flex-fill m-0"
                disabled={submitting}
                onClick={onHide}
                // Focus the non-destructive action: this dialog can be reached
                // by keyboard and Enter should not delete anything.
                autoFocus
            >
                Cancel
            </Button>
            <Button
                variant="danger"
                className="flex-fill m-0 d-inline-flex align-items-center justify-content-center gap-2"
                disabled={submitting}
                onClick={onDelete}
            >
                {submitting && <Spinner animation="border" size="sm" />}
                {submitting ? "Deleting..." : "Delete"}
            </Button>
        </Modal.Footer>
    </Modal>
);

export default DeleteConfirmationModal;
