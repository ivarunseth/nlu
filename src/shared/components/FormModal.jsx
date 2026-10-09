import { Button, Form, Modal, Spinner } from "react-bootstrap";

// Shared shell for the app's create/edit dialogs (model, label, entity, slot).
// Those four differed only in their fields — the Modal, the validated Form
// wrapper and the submit button were duplicated verbatim in each. Callers pass
// the fields as children and keep owning all form state.
//
// Unlike the single-message dialogs (SessionExpiredModal, DeleteConfirmation-
// Modal) this keeps a conventional left-aligned header: a form needs its title
// on the same axis as its labels, so the centered icon composition that suits
// an announcement would fight the content here.
const FormModal = ({
    show,
    title,
    validated,
    submitting,
    size,
    scrollable = false,
    submitLabel = "Submit",
    submittingLabel = "Submitting...",
    onHide,
    onSubmit,
    children
}) => (
    <Modal
        centered
        show={show}
        size={size}
        // Long forms scroll their body instead of pushing the footer off a
        // short viewport, which is where the submit button lives.
        scrollable={scrollable}
        // Closing mid-request would strand the caller's submitting state.
        onHide={submitting ? undefined : onHide}
        aria-labelledby="form-modal-title"
    >
        <Form noValidate validated={validated} onSubmit={onSubmit}>
            <Modal.Header closeButton={!submitting} className="border-0 px-4 pt-4 pb-0">
                <Modal.Title id="form-modal-title" as="h5" className="fw-semibold mb-0">
                    {title}
                </Modal.Title>
            </Modal.Header>
            <Modal.Body className="px-4 py-3">
                {children}
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
                    variant="primary"
                    className="flex-fill m-0 d-inline-flex align-items-center justify-content-center gap-2"
                    disabled={submitting}
                >
                    {submitting && <Spinner animation="border" size="sm" />}
                    {submitting ? submittingLabel : submitLabel}
                </Button>
            </Modal.Footer>
        </Form>
    </Modal>
);

export default FormModal;
