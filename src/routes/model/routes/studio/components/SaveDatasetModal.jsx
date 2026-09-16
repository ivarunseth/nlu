import { Button, Modal, Spinner } from "react-bootstrap";
import { CloudArrowUp } from "react-bootstrap-icons";

// Confirms a dataset save from the JSON view. Rows the document no longer
// lists are deleted by omission, so the summary is what stands between a
// slipped bracket and a wiped collection: it names, per collection, exactly
// what the one-transaction PUT will create, update and delete.
//
// `changes` is the diff from DatasetJson: { [collection]: { created, updated,
// deleted } } with only touched collections present. Copy follows the
// SessionExpiredModal composition and Bootstrap semantic tokens.
const SaveDatasetModal = ({ show, changes, submitting, onHide, onSave }) => {
    const collections = Object.entries(changes || {});
    const deletes = collections.reduce((sum, [, counts]) => sum + counts.deleted, 0);

    return (
        <Modal
            centered
            show={show}
            onHide={submitting ? undefined : onHide}
            aria-labelledby="save-dataset-title"
        >
            <Modal.Body className="text-center px-4 pt-4 pb-3">
                <div
                    className={`d-inline-flex align-items-center justify-content-center rounded-circle mb-3 ${
                        deletes > 0 ? "bg-danger-subtle text-danger-emphasis" : "bg-primary-subtle text-primary-emphasis"
                    }`}
                    style={{ width: "3.5rem", height: "3.5rem" }}
                    aria-hidden="true"
                >
                    <CloudArrowUp size={26} />
                </div>
                <h5 id="save-dataset-title" className="fw-semibold mb-2">
                    Save dataset changes
                </h5>
                <p className="text-body-secondary mb-3">
                    These changes are written together, in one step. If any of them
                    is invalid, none of them are saved.
                </p>
                <ul className="list-unstyled text-start small bg-body-secondary rounded p-3 mb-0">
                    {collections.map(([collection, counts]) => (
                        <li key={collection} className="d-flex justify-content-between gap-3">
                            <span className="fw-medium text-capitalize">{collection}</span>
                            <span className="text-body-secondary">
                                {[
                                    counts.created > 0 && `${counts.created} created`,
                                    counts.updated > 0 && `${counts.updated} updated`,
                                    counts.deleted > 0 && (
                                        <span key="deleted" className="text-danger-emphasis">
                                            {counts.deleted} deleted
                                        </span>
                                    )
                                ].filter(Boolean).map((part, index) => (
                                    <span key={index}>
                                        {index > 0 && " · "}
                                        {part}
                                    </span>
                                ))}
                            </span>
                        </li>
                    ))}
                </ul>
                {deletes > 0 && (
                    <small className="d-block text-body-secondary mt-3">
                        Deleted rows, and any annotations on them, cannot be recovered.
                    </small>
                )}
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
                    variant={deletes > 0 ? "danger" : "primary"}
                    className="flex-fill m-0"
                    disabled={submitting}
                    onClick={onSave}
                    autoFocus
                >
                    {submitting ? (
                        <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
                    ) : (
                        "Save changes"
                    )}
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default SaveDatasetModal;
