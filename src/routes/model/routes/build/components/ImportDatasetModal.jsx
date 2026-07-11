import { useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { CheckCircle, ExclamationTriangle } from "react-bootstrap-icons";

export const DATASET_FORMATS = [
    { value: "inline", label: "Inline — {entity: value} per line" },
    { value: "csv", label: "CSV — text and space-separated IOB tags columns" },
    { value: "conll", label: "CoNLL / IOB — token and tag per line" },
    { value: "json", label: "JSON spans — {text, entities:[…]} per line" }
];

// Imports a pre-annotated dataset into a named entity recognition model.
// Holds its own file/format state; the parent runs the upload and passes back
// a { imported, created, errors } summary, which stays shown until the modal
// is closed so the annotator can read the per-line error report.
const ImportDatasetModal = ({ show, submitting, summary, onHide, onSubmit }) => {
    const [file, setFile] = useState(null);
    const [format, setFormat] = useState("inline");

    const handleSubmit = (e) => {
        e.preventDefault();
        if (file) onSubmit(file, format);
    };

    const handleHide = () => {
        setFile(null);
        setFormat("inline");
        onHide();
    };

    return (
        <Modal centered show={show} onHide={handleHide}>
            <Modal.Header closeButton>
                <Modal.Title>Import dataset</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form onSubmit={handleSubmit}>
                    <Form.Group className="mb-3">
                        <Form.Floating>
                            <Form.Select id="import-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                                {DATASET_FORMATS.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                            </Form.Select>
                            <Form.Label htmlFor="import-format">Format</Form.Label>
                        </Form.Floating>
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Dataset</Form.Label>
                        <Form.Control type="file" onChange={(e) => setFile(e.target.files[0])} />
                        <Form.Text muted>
                            One annotated utterance per line (or per blank-line block for CoNLL).
                            Entities that don't exist yet are created automatically.
                        </Form.Text>
                    </Form.Group>
                    {summary && (
                        <Alert variant={summary.errors.length > 0 ? "warning" : "success"} className="small">
                            <div className="d-flex align-items-center gap-2 fw-bold">
                                {summary.errors.length > 0 ? <ExclamationTriangle /> : <CheckCircle />}
                                Imported {summary.imported} utterance{summary.imported === 1 ? "" : "s"}
                                {summary.created.length > 0 && `, created ${summary.created.length} entit${summary.created.length === 1 ? "y" : "ies"}`}.
                            </div>
                            {summary.errors.length > 0 && (
                                <ul className="mb-0 mt-2 ps-3">
                                    {summary.errors.slice(0, 10).map((item, index) => (
                                        <li key={index}>Line {item.line}: {item.error}</li>
                                    ))}
                                    {summary.errors.length > 10 && <li>…and {summary.errors.length - 10} more.</li>}
                                </ul>
                            )}
                        </Alert>
                    )}
                    <div className="d-grid gap-2">
                        <Button type="submit" variant="light" className="border" disabled={submitting || !file}>
                            {submitting ? (
                                <><Spinner animation="border" size="sm" />&nbsp;Importing...</>
                            ) : (
                                "Import"
                            )}
                        </Button>
                    </div>
                </Form>
            </Modal.Body>
        </Modal>
    );
};

export default ImportDatasetModal;
