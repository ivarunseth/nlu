import axios from "axios";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from "react-bootstrap";
import { BookmarkStar, InfoCircle, Option, Pen, PlusLg, Quote, Tags, Trash } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../../contexts/UserContext";
import AppPagination from "../../../../../shared/components/AppPagination";
import DeleteConfirmationModal from "../../../../../shared/components/DeleteConfirmationModal";
import MetricsStrip from "../../../../../shared/components/MetricsStrip";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

const PER_PAGE = 10;
const MAX_VISIBLE_PAGES = 5;

// Splits the synonyms free-text input into clean, de-duplicated terms.
const parseSynonyms = (raw) => {
    const seen = new Set();
    return raw
        .split(",")
        .map((term) => term.replace(/\s+/g, " ").trim())
        .filter((term) => {
            if (!term || seen.has(term.toLowerCase())) return false;
            seen.add(term.toLowerCase());
            return true;
        });
};

// The drill-in of one entity, on both named entity recognition and language
// understanding models: the authored value catalogue — each canonical value
// with its synonyms, editable in place. Values are catalogued automatically
// on import and annotation, so this is the single source of truth. The
// catalogue feeds training-data generation: closed-list entities enumerate
// through it, open-list entities use it as samples besides the UNK
// generalization.
const EntityValues = ({ entityId }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [alert, setAlert] = useState(null);
    const [entity, setEntity] = useState(null);
    const [values, setValues] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);

    const [showForm, setShowForm] = useState(false);
    const [current, setCurrent] = useState(null);
    const [valueText, setValueText] = useState("");
    const [synonymsText, setSynonymsText] = useState("");
    const [toDelete, setToDelete] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const headers = useMemo(() => ({ Authorization: `Bearer ${user?.token}` }), [user]);

    const showError = (error, fallback = "Something went wrong.") => {
        setAlert({ variant: "danger", message: error?.response?.data?.error || fallback });
    };

    const getValues = useCallback(async () => {
        try {
            setLoading(true);
            const response = await axios.get(
                `/api/models/${modelId}/entities/${entityId}/values`,
                { headers }
            );
            setEntity(response.data.entity);
            setValues(response.data.values);
        } catch (error) {
            showError(error);
        } finally {
            setLoading(false);
        }
    }, [modelId, entityId, headers]);

    useEffect(() => {
        if (user && modelId && entityId) getValues();
    }, [user, modelId, entityId, getValues]);

    const closeForm = () => {
        setShowForm(false);
        setCurrent(null);
        setSubmitting(false);
    };

    const handleOpenCreate = () => {
        setCurrent(null);
        setValueText("");
        setSynonymsText("");
        setShowForm(true);
    };

    const handleOpenEdit = (value) => {
        setCurrent(value);
        setValueText(value.value);
        setSynonymsText(value.synonyms.map((synonym) => synonym.text).join(", "));
        setShowForm(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = { value: valueText.trim(), synonyms: parseSynonyms(synonymsText) };
        if (!payload.value) return;
        try {
            setSubmitting(true);
            if (current) {
                await axios.put(
                    `/api/models/${modelId}/entities/${entityId}/values/${current.id}`,
                    payload, { headers }
                );
            } else {
                await axios.post(
                    `/api/models/${modelId}/entities/${entityId}/values`,
                    payload, { headers }
                );
            }
            closeForm();
            getValues();
        } catch (error) {
            setSubmitting(false);
            showError(error);
        }
    };

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            await axios.delete(
                `/api/models/${modelId}/entities/${entityId}/values/${toDelete.id}`,
                { headers }
            );
            // Removing the last row on a trailing page steps back a page.
            const remaining = values.length - 1;
            if (page > 1 && remaining <= (page - 1) * PER_PAGE) setPage(page - 1);
            getValues();
        } catch (error) {
            showError(error);
        } finally {
            setToDelete(null);
            setSubmitting(false);
        }
    };

    const synonymsTotal = values.reduce((total, value) => total + value.synonyms.length, 0);
    const coveredSpans = values.reduce((total, value) => total + (value.count || 0), 0);
    const pagedValues = values.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    return (
        <>
            {alert && (
                <Alert className="mt-4" variant={alert.variant} onClose={() => setAlert(null)} dismissible>
                    {alert.message}
                </Alert>
            )}
            <MetricsStrip
                className="mt-4"
                items={[
                    { label: "Values", value: values.length, icon: <Quote /> },
                    { label: "Synonyms", value: synonymsTotal, icon: <Tags /> },
                    { label: "Covered spans", value: coveredSpans, icon: <BookmarkStar /> }
                ]}
            />
            <div className="d-flex align-items-center mt-4">
                <div className="flex-grow-1">
                    {entity && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                            {entity.list_type === "closed" ? "closed list" : "open list"}
                        </Badge>
                    )}
                </div>
                <Button variant="light" className="border" onClick={handleOpenCreate}>
                    <PlusLg />&nbsp;add value
                </Button>
            </div>
            <Card className="border-light overflow-hidden mt-3">
                <CardHeading
                    icon={<Quote />}
                    title="Values"
                    right={
                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                            {values.length} value{values.length === 1 ? "" : "s"} · {synonymsTotal} synonym{synonymsTotal === 1 ? "" : "s"}
                        </span>
                    }
                />
                <Card.Body className="p-0">
                    <Table responsive hover className="mb-0 align-middle">
                        <thead>
                            <tr>
                                <th className="ps-3">Value</th>
                                <th>Synonyms</th>
                                <th className="text-center">Spans</th>
                                <th className="text-center"><Option className="text-muted" />&nbsp;Options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-5">
                                        <Spinner animation="border" size="lg" />
                                    </td>
                                </tr>
                            ) : values.length > 0 ? pagedValues.map((value) => (
                                <tr key={value.id}>
                                    <td className="ps-3 text-break fw-medium">{value.value}</td>
                                    <td>
                                        {value.synonyms.length > 0 ? (
                                            <div className="d-flex flex-wrap gap-1">
                                                {value.synonyms.map((synonym) => (
                                                    <Badge key={synonym.id} bg="light" text="dark" className="border fw-normal">
                                                        {synonym.text}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-muted small">—</span>
                                        )}
                                    </td>
                                    <td className="text-center">
                                        <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                            {value.count ?? 0}
                                        </Badge>
                                    </td>
                                    <td className="text-center">
                                        <Button
                                            variant="light"
                                            size="sm"
                                            className="border me-1"
                                            title={`Edit ${value.value}`}
                                            aria-label={`Edit ${value.value}`}
                                            onClick={() => handleOpenEdit(value)}
                                        >
                                            <Pen />
                                        </Button>
                                        <Button
                                            variant="light"
                                            size="sm"
                                            className="border text-danger"
                                            title={`Delete ${value.value}`}
                                            aria-label={`Delete ${value.value}`}
                                            onClick={() => setToDelete(value)}
                                        >
                                            <Trash />
                                        </Button>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="text-center py-4">
                                        <EmptyMessage icon={<InfoCircle />}>
                                            no values yet — add the terms this entity can take
                                            {entity?.list_type === "closed"
                                                ? "; a closed list trains on exactly this catalogue."
                                                : "; an open list also generalizes to unseen values."}
                                        </EmptyMessage>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                </Card.Body>
            </Card>
            <div className="mt-3">
                <AppPagination
                    page={page}
                    total={values.length}
                    perPage={PER_PAGE}
                    maxVisiblePages={MAX_VISIBLE_PAGES}
                    onPageChange={setPage}
                />
            </div>
            <Modal centered show={showForm} onHide={closeForm}>
                <Modal.Header closeButton>
                    <Modal.Title>{current ? "Edit value" : "Add value"}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3">
                            <Form.Floating>
                                <Form.Control
                                    id="entity-value"
                                    type="text"
                                    placeholder="Enter a value..."
                                    value={valueText}
                                    onChange={(e) => setValueText(e.target.value)}
                                    autoFocus
                                    required
                                />
                                <Form.Label htmlFor="entity-value">Value</Form.Label>
                            </Form.Floating>
                            <Form.Text muted>
                                The canonical surface form, e.g. <code>latte</code>.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Floating>
                                <Form.Control
                                    id="entity-value-synonyms"
                                    as="textarea"
                                    placeholder="Enter synonyms..."
                                    value={synonymsText}
                                    onChange={(e) => setSynonymsText(e.target.value)}
                                    style={{ height: "80px" }}
                                />
                                <Form.Label htmlFor="entity-value-synonyms">Synonyms</Form.Label>
                            </Form.Floating>
                            <Form.Text muted>
                                Comma-separated variants meaning the same value, e.g.
                                <code> caffè latte, milk coffee</code>. Each must be unique
                                within the entity.
                            </Form.Text>
                        </Form.Group>
                        <div className="d-grid gap-2">
                            <Button type="submit" variant="light" className="border" disabled={submitting}>
                                {submitting ? (
                                    <>
                                        <Spinner animation="border" size="sm" />
                                        &nbsp;Submitting...
                                    </>
                                ) : (
                                    "Submit"
                                )}
                            </Button>
                        </div>
                    </Form>
                </Modal.Body>
            </Modal>
            <DeleteConfirmationModal
                show={toDelete != null}
                title="Delete value"
                items={toDelete ? [
                    `${toDelete.value} (removes ${toDelete.synonyms.length} synonym${toDelete.synonyms.length === 1 ? "" : "s"}; annotations are untouched)`
                ] : []}
                itemType="value"
                submitting={submitting}
                onHide={() => setToDelete(null)}
                onDelete={handleDelete}
            />
        </>
    );
};

export default EntityValues;
