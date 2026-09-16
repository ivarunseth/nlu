import { Button, Modal, Spinner } from "react-bootstrap";
import { ExclamationTriangle } from "react-bootstrap-icons";

// Raised when the user navigates away from the JSON view with edits the
// server hasn't seen. The edits live only in this page, so leaving loses
// them; the three ways out are stay, leave without them, or save first.
// Composition and tokens follow SessionExpiredModal.
const UnsavedChangesModal = ({ show, changeCount, saving, onStay, onDiscard, onSave }) => (
    <Modal
        centered
        show={show}
        // Esc / backdrop mean "stay" — never a silent discard.
        onHide={saving ? undefined : onStay}
        aria-labelledby="unsaved-changes-title"
    >
        <Modal.Body className="text-center px-4 pt-4 pb-3">
            <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning-emphasis mb-3"
                style={{ width: "3.5rem", height: "3.5rem" }}
                aria-hidden="true"
            >
                <ExclamationTriangle size={24} />
            </div>
            <h5 id="unsaved-changes-title" className="fw-semibold mb-2">
                Unsaved changes
            </h5>
            <p className="text-body-secondary mb-0">
                {changeCount === 1
                    ? "There is 1 unsaved change to this dataset. Leaving now discards it."
                    : `There are ${changeCount} unsaved changes to this dataset. Leaving now discards them.`}
            </p>
        </Modal.Body>
        <Modal.Footer className="border-0 d-flex gap-2 px-4 pb-4 pt-0">
            <Button
                variant="light"
                className="border flex-fill m-0"
                disabled={saving}
                onClick={onStay}
                autoFocus
            >
                Keep editing
            </Button>
            <Button
                variant="light"
                className="border text-danger-emphasis flex-fill m-0"
                disabled={saving}
                onClick={onDiscard}
            >
                Discard
            </Button>
            <Button
                variant="primary"
                className="flex-fill m-0"
                disabled={saving}
                onClick={onSave}
            >
                {saving ? (
                    <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
                ) : (
                    "Save and leave"
                )}
            </Button>
        </Modal.Footer>
    </Modal>
);

export default UnsavedChangesModal;
