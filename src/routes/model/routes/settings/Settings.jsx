import { useApi } from "../../../../contexts/ApiContext";
import { useContext, useEffect, useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { Boxes, Calendar3, Clock, ExclamationTriangleFill, Gear, Hash, Stack } from "react-bootstrap-icons";
import { useNavigate, useParams } from "react-router-dom";
import { ModelContext } from "../../../../contexts/ModelContext";
import { CardHeading, SectionLabel } from "../../../../shared/components/SectionCard";
import ModelStatusBadge from "../../../../shared/components/ModelStatusBadge";
import FileDropzone from "../../../../shared/components/FileDropzone";
import TypeToConfirmModal from "../../../../shared/components/TypeToConfirmModal";

// Human-readable label for each model kind (kinds are create-time only).
const KIND_LABELS = {
    text_classification: "Text classification",
    named_entity_recognition: "Named entity recognition",
    natural_language_understanding: "Natural language understanding"
};

// A read-only fact about the model, laid out as a label/value row.
const DetailRow = ({ icon, label, children }) => (
    <div className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 border-top border-light-subtle small">
        <span className="text-muted d-inline-flex align-items-center gap-2">
            <span className="text-primary lh-1">{icon}</span>
            {label}
        </span>
        <span className="text-body-emphasis text-end">{children}</span>
    </div>
);

const Settings = () => {
    const { modelId } = useParams();
    const api = useApi();
    const { model, setModel } = useContext(ModelContext);
    const navigate = useNavigate();

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [validated, setValidated] = useState(false);
    const [saving, setSaving] = useState(false);
    const [alert, setAlert] = useState(null);

    const [showDelete, setShowDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    // Prime the form once the model context resolves (or changes).
    useEffect(() => {
        if (model) {
            setName(model.name || "");
            setDescription(model.description || "");
        }
    }, [model?.id]);

    const importAlert = (summary) => {
        if (!summary) return { variant: "success", message: "Model updated." };
        const skipped = summary.errors.length;
        let message = `Imported ${summary.imported} utterance${summary.imported === 1 ? "" : "s"}`;
        if (summary.created.length > 0) {
            message += `, created ${summary.created.length} definition${summary.created.length === 1 ? "" : "s"} (intents, entities and slots)`;
        }
        if (skipped > 0) {
            const first = summary.errors[0];
            message += `. Skipped ${skipped} row${skipped === 1 ? "" : "s"} — e.g. line ${first.line}: ${first.error}`;
        } else {
            message += ".";
        }
        return { variant: skipped > 0 ? "warning" : "success", message };
    };

    const handleSave = async (event) => {
        event.preventDefault();
        setValidated(true);
        if (name.trim() === "") return;
        setAlert(null);
        try {
            setSaving(true);
            const data = new FormData();
            data.append("name", name.trim());
            data.append("description", description);
            if (dataset) {
                data.append("dataset", dataset);
                data.append("header", header);
            }
            const { import_summary: importSummary, ...updated } = await api.models.update(modelId, data);
            setModel(updated);
            setDataset(null);
            setHeader(true);
            setAlert(importAlert(importSummary));
        } catch (error) {
            setAlert({ variant: "danger", message: error.response?.data?.error || error.message });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setDeleteError(null);
        try {
            setDeleting(true);
            await api.models.remove(modelId);
            navigate("/");
        } catch (error) {
            setDeleteError(error.response?.data?.error || error.response?.data?.message || error.message);
            setDeleting(false);
        }
    };

    if (!model) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "40vh" }}>
                <Spinner animation="border" variant="secondary" />
            </div>
        );
    }

    // Classification models take a text,label CSV/TSV; annotated models take a
    // corpus whose format is inferred from the file extension.
    const isAnnotated = model.kind === "named_entity_recognition"
        || model.kind === "natural_language_understanding";

    return (
        <div className="pb-5">
            <Row className="mt-4 g-4">
                <Col lg={7}>
                    <Card className="border-light overflow-hidden">
                        <CardHeading icon={<Gear />} title="Model settings" />
                        <Card.Body className="p-3">
                            {alert && (
                                <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible className="small py-2">
                                    {alert.message}
                                </Alert>
                            )}
                            <Form noValidate validated={validated} onSubmit={handleSave}>
                                <Form.Group className="mb-3">
                                    <Form.Label className="small fw-bold mb-1">Name</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={name}
                                        placeholder="Model name"
                                        onChange={(event) => setName(event.target.value)}
                                        required
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please enter a name.
                                    </Form.Control.Feedback>
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label className="small fw-bold mb-1">Type</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={KIND_LABELS[model.kind] || model.kind}
                                        readOnly
                                        disabled
                                    />
                                    <Form.Text muted style={{ fontSize: "var(--app-text-xs)" }}>
                                        A model's type is fixed once it is created.
                                    </Form.Text>
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label className="small fw-bold mb-1">Description</Form.Label>
                                    <Form.Control
                                        as="textarea"
                                        value={description}
                                        placeholder="What is this model for?"
                                        onChange={(event) => setDescription(event.target.value)}
                                        style={{ height: "100px" }}
                                    />
                                </Form.Group>
                                <Form.Group className="mb-2">
                                    <Form.Label className="small fw-bold mb-1" htmlFor="replace-dataset">Replace dataset</Form.Label>
                                    <FileDropzone
                                        id="replace-dataset"
                                        file={dataset}
                                        onSelect={setDataset}
                                        accept=".csv,.tsv"
                                        disabled={saving}
                                        clearDisabled={saving}
                                        minHeight="96px"
                                        prompt="Drag and drop a dataset here, or click to browse."
                                        hint={`Optional · replaces this model's existing${isAnnotated ? " utterances and their annotations" : " utterances"}`}
                                    />
                                </Form.Group>
                                {!isAnnotated && (
                                    <Form.Group className="mb-3">
                                        <Form.Check
                                            type="checkbox"
                                            id="settings-header"
                                            className="small"
                                            label="contains header"
                                            disabled={!dataset}
                                            checked={header}
                                            onChange={(event) => setHeader(event.target.checked)}
                                        />
                                    </Form.Group>
                                )}
                                <div className="d-flex justify-content-end gap-2 mt-3">
                                    <Button variant="light" className="border" disabled={saving} onClick={() => navigate("/")}>
                                        Cancel
                                    </Button>
                                    <Button type="submit" variant="primary" className="d-inline-flex align-items-center gap-2" disabled={saving}>
                                        {saving && <Spinner animation="border" size="sm" />}
                                        Save
                                    </Button>
                                </div>
                            </Form>
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={5}>
                    <Card className="border-light overflow-hidden">
                        <CardHeading icon={<Hash />} title="Details" />
                        <Card.Body className="p-0">
                            <DetailRow icon={<Hash />} label="Model ID">
                                <span className="font-monospace text-truncate d-inline-block" style={{ maxWidth: "180px" }} title={model.id}>
                                    {model.id}
                                </span>
                            </DetailRow>
                            <DetailRow icon={<Stack />} label="Type">
                                {KIND_LABELS[model.kind] || model.kind}
                            </DetailRow>
                            <DetailRow icon={<Boxes />} label="Status">
                                <ModelStatusBadge status={model.status} />
                            </DetailRow>
                            <DetailRow icon={<Calendar3 />} label="Created">
                                {model.created_at}
                            </DetailRow>
                            <DetailRow icon={<Clock />} label="Updated">
                                {model.updated_at}
                            </DetailRow>
                        </Card.Body>
                    </Card>

                    <Card className="border-danger-subtle overflow-hidden mt-4">
                        <div className="d-flex align-items-center gap-2 px-3 py-2 bg-body-tertiary border-bottom border-danger-subtle text-danger">
                            <ExclamationTriangleFill />
                            <SectionLabel>Danger zone</SectionLabel>
                        </div>
                        <Card.Body className="p-3">
                            <p className="small text-muted mb-3">
                                Deleting this model permanently removes its dataset, trainings and
                                deployments. This cannot be undone.
                            </p>
                            <Button variant="outline-danger" onClick={() => setShowDelete(true)}>
                                Delete model
                            </Button>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <TypeToConfirmModal
                show={showDelete}
                title={`Delete ${model.name}`}
                confirmWord="delete"
                confirmLabel="Delete model"
                submitting={deleting}
                error={deleteError}
                onHide={() => { setShowDelete(false); setDeleteError(null); }}
                onConfirm={handleDelete}
            >
                <p className="small">
                    This permanently deletes <strong>{model.name}</strong> along with its dataset,
                    trainings and any live deployments. This action cannot be undone.
                </p>
            </TypeToConfirmModal>
        </div>
    );
};

export default Settings;
