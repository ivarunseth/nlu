import { Button, Modal, Spinner } from "react-bootstrap";

const DeleteConfirmationModal = ({
    show,
    title,
    itemName,
    itemType,
    submitting,
    onHide,
    onDelete
}) => (
    <Modal centered show={show} onHide={onHide}>
        <Modal.Header closeButton>
            <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
            <p>Are you sure you want to delete the {itemType} "{itemName}"?</p>
            <Button
                type="submit"
                variant="danger"
                disabled={submitting}
                onClick={onDelete}
            >
                {submitting ? (
                    <>
                        <Spinner animation="border" size="sm" />
                        &nbsp;
                        Deleting...
                    </>
                ) : (
                    "Delete"
                )}
            </Button>
        </Modal.Body>
    </Modal>
);

export default DeleteConfirmationModal;
