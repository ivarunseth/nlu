import { Button, Modal, Spinner } from "react-bootstrap";

const DeleteConfirmationModal = ({
    show,
    title,
    items = [],
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
            {items.length > 1 ? (
                <>
                    <p>Are you sure you want to delete these {items.length} {itemType}s?</p>
                    <ul className="small text-muted">
                        {items.map((name) => <li key={name}>{name}</li>)}
                    </ul>
                </>
            ) : (
                <p>Are you sure you want to delete the {itemType} "{items[0]}"?</p>
            )}
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
