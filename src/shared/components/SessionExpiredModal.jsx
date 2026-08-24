import { Button, Modal } from "react-bootstrap";
import { ShieldLock } from "react-bootstrap-icons";

// Expiry is terminal: server/auth.py nulls the token in the database when it
// expires, so there is nothing to refresh and exactly one thing the user can
// do. Hence no close button, no backdrop click, no escape key.
//
// Colours come from Bootstrap 5.3 semantic tokens rather than fixed values so
// the modal follows data-bs-theme without a second set of dark-mode rules.
const SessionExpiredModal = ({ show, onSignIn }) => (
    <Modal
        centered
        show={show}
        backdrop="static"
        keyboard={false}
        aria-labelledby="session-expired-title"
    >
        <Modal.Body className="text-center px-4 pt-4 pb-3">
            <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle bg-body-secondary text-body-secondary mb-3"
                style={{ width: "3.5rem", height: "3.5rem" }}
                aria-hidden="true"
            >
                <ShieldLock size={26} />
            </div>
            <h5 id="session-expired-title" className="fw-semibold mb-2">
                Your session has expired
            </h5>
            <p className="text-body-secondary mb-0">
                You have been signed out. Please sign in again to continue.
            </p>
        </Modal.Body>
        <Modal.Footer className="border-0 flex-column px-4 pb-4 pt-0">
            <Button
                variant="primary"
                className="w-100"
                onClick={onSignIn}
                // Esc and backdrop dismissal are both disabled, so focusing the
                // only control keeps the modal operable from the keyboard.
                autoFocus
            >
                Sign in again
            </Button>
            <small className="text-body-secondary mt-3 mx-0">
                Any unsaved changes on this page will not be kept.
            </small>
        </Modal.Footer>
    </Modal>
);

export default SessionExpiredModal;
