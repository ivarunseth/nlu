import { useApi } from "../../../../../contexts/ApiContext";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from "react-bootstrap";
import { BookmarkStar, InfoCircle, Option, PlusLg, Quote, Tags, Trash, XLg } from "react-bootstrap-icons";
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
    const [valueText, setValueText] = useState("");
    const [synonymsText, setSynonymsText] = useState("");
    const [toDelete, setToDelete] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    // Every value cell is a live field, so edits are tracked per value id: an
    // entry exists only once that row has been typed into, and is dropped again
    // once the change is committed (or reverted), leaving the cell to render the
    // server's value.
    const [valueDrafts, setValueDrafts] = useState({});
    // Rows whose save just landed, for the brief underline flash.
    const [savedIds, setSavedIds] = useState(() => new Set());
    // Escape reverts by clearing the draft and blurring — but blur is also the
    // commit path, and React batches the state update behind it, so the commit
    // would still see the old draft. This tells it to stand down.
    const cancelledRef = useRef(false);
    // Ids of rows with an in-flight synonym add/remove — disables that row's
    // controls so a slow request can't race a second click.
    const [pendingIds, setPendingIds] = useState(() => new Set());
    // The "add synonym" input text, per value id.
    const [synonymDrafts, setSynonymDrafts] = useState({});

    const api = useApi();

    const showError = (error, fallback = "Something went wrong.") => {
        setAlert({ variant: "danger", message: error?.response?.data?.error || fallback });
    };

    // `quiet` refetches without the full-table spinner: the inline edits below
    // change one cell, so flashing the whole table on every keystroke-sized
    // save would be far more disruptive than the update it is reporting.
    const getValues = useCallback(async (quiet = false) => {
        try {
            if (!quiet) setLoading(true);
            const { entity, values } = await api.values.list(modelId, entityId);
            setEntity(entity);
            setValues(values);
        } catch (error) {
            showError(error);
        } finally {
            if (!quiet) setLoading(false);
        }
    }, [modelId, entityId, api]);

    useEffect(() => {
        if (user && modelId && entityId) getValues();
    }, [user, modelId, entityId, getValues]);

    // --- Value renaming (in place, in the table cell) ------------------------

    const valueDraft = (value) => valueDrafts[value.id] ?? value.value;

    const setValueDraft = (id, text) => {
        setValueDrafts((previous) => ({ ...previous, [id]: text }));
    };

    const clearValueDraft = (id) => {
        setValueDrafts((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
        });
    };

    const flashSaved = (id) => {
        setSavedIds((previous) => new Set(previous).add(id));
        window.setTimeout(() => setSavedIds((previous) => {
            const next = new Set(previous);
            next.delete(id);
            return next;
        }), 1200);
    };

    // Blur is the single commit path — Enter just blurs the field, so a rename
    // can never be applied twice by pressing Enter and then clicking away.
    const commitValue = async (value) => {
        if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
        }
        const draft = valueDrafts[value.id];
        if (draft === undefined) return;
        const trimmed = draft.trim();
        // Blanked or unchanged — drop the draft and fall back to the stored
        // value rather than sending a no-op (or a rejected empty rename).
        if (!trimmed || trimmed === value.value) {
            clearValueDraft(value.id);
            return;
        }
        try {
            await api.values.update(modelId, entityId, value.id, { value: trimmed });
            // Refetch before dropping the draft: clearing it first would flash
            // the old stored name back into the cell until the refetch lands.
            await getValues(true);
            clearValueDraft(value.id);
            flashSaved(value.id);
        } catch (error) {
            // Keep the draft so a rejected rename (e.g. a duplicate, surfaced
            // in the alert above) can be corrected rather than retyped.
            showError(error);
        }
    };

    const handleValueKeyDown = (e, value) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.target.blur();
        } else if (e.key === "Escape") {
            cancelledRef.current = true;
            clearValueDraft(value.id);
            e.target.blur();
        }
    };

    const isPending = (id) => pendingIds.has(id);

    const setPending = (id, pending) => {
        setPendingIds((previous) => {
            const next = new Set(previous);
            if (pending) next.add(id); else next.delete(id);
            return next;
        });
    };

    // Shared by add and remove: both send the full recomputed synonym list,
    // since the API replaces the set wholesale (Value.from_dict). Returns
    // whether it succeeded, so callers can decide what to reset.
    const saveSynonyms = async (value, terms) => {
        setPending(value.id, true);
        try {
            await api.values.update(modelId, entityId, value.id, { synonyms: terms });
            await getValues(true);
            return true;
        } catch (error) {
            showError(error);
            return false;
        } finally {
            setPending(value.id, false);
        }
    };

    const synonymDraft = (id) => synonymDrafts[id] || "";

    const setSynonymDraft = (id, text) => {
        setSynonymDrafts((previous) => ({ ...previous, [id]: text }));
    };

    const handleAddSynonym = async (value) => {
        const term = synonymDraft(value.id).trim();
        if (!term) return;
        const terms = [...value.synonyms.map((synonym) => synonym.text), term];
        const ok = await saveSynonyms(value, terms);
        // On failure (e.g. a duplicate term) keep what was typed so it can be
        // corrected instead of retyped.
        if (ok) setSynonymDraft(value.id, "");
    };

    const handleRemoveSynonym = (value, synonymId) => {
        const terms = value.synonyms
            .filter((synonym) => synonym.id !== synonymId)
            .map((synonym) => synonym.text);
        saveSynonyms(value, terms);
    };

    const closeForm = () => {
        setShowForm(false);
        setSubmitting(false);
    };

    const handleOpenCreate = () => {
        setValueText("");
        setSynonymsText("");
        setShowForm(true);
    };

    // Only creates: an existing value is renamed, and its synonyms added or
    // removed, in place in its table row.
    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = { value: valueText.trim(), synonyms: parseSynonyms(synonymsText) };
        if (!payload.value) return;
        try {
            setSubmitting(true);
            await api.values.create(modelId, entityId, payload);
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
            await api.values.remove(modelId, entityId, toDelete.id);
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
                <Button variant="primary" onClick={handleOpenCreate}>
                    <PlusLg />&nbsp;add value
                </Button>
            </div>
            <Card className="border-light overflow-hidden mt-3">
                <CardHeading
                    icon={<Quote />}
                    title="Values"
                    right={
                        <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
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
                                    <td className="ps-3 fw-medium" style={{ minWidth: "10rem" }}>
                                        <input
                                            type="text"
                                            className={`inline-edit${savedIds.has(value.id) ? " inline-edit-saved" : ""}`}
                                            value={valueDraft(value)}
                                            placeholder="value"
                                            aria-label={`Value ${value.value}`}
                                            title="Click to rename — Enter to save, Esc to revert"
                                            onChange={(e) => setValueDraft(value.id, e.target.value)}
                                            onBlur={() => commitValue(value)}
                                            onKeyDown={(e) => handleValueKeyDown(e, value)}
                                        />
                                    </td>
                                    <td>
                                        {/* Chips and the add-field share one wrapping row, so the
                                            field simply flows after the last chip and drops to its
                                            own line when the column narrows. The cap keeps a value
                                            with many synonyms scrolling inside its own cell rather
                                            than stretching the whole row. */}
                                        <div
                                            className="d-flex flex-wrap align-items-center gap-1"
                                            style={{ maxHeight: "4.5rem", overflowY: "auto" }}
                                        >
                                            {value.synonyms.map((synonym) => (
                                                <Badge
                                                    key={synonym.id}
                                                    bg="light"
                                                    text="dark"
                                                    className="synonym-chip border fw-normal d-inline-flex align-items-center gap-1"
                                                >
                                                    {synonym.text}
                                                    <XLg
                                                        role="button"
                                                        className="synonym-remove"
                                                        aria-label={`Remove synonym ${synonym.text}`}
                                                        size={10}
                                                        style={{ pointerEvents: isPending(value.id) ? "none" : "auto" }}
                                                        onClick={() => handleRemoveSynonym(value, synonym.id)}
                                                    />
                                                </Badge>
                                            ))}
                                            <span className="synonym-add">
                                                <input
                                                    type="text"
                                                    placeholder="add synonym"
                                                    aria-label={`Add a synonym to ${value.value}`}
                                                    value={synonymDraft(value.id)}
                                                    disabled={isPending(value.id)}
                                                    onChange={(e) => setSynonymDraft(value.id, e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            handleAddSynonym(value);
                                                        }
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    title="Add synonym"
                                                    aria-label={`Add a synonym to ${value.value}`}
                                                    disabled={isPending(value.id) || !synonymDraft(value.id).trim()}
                                                    onClick={() => handleAddSynonym(value)}
                                                >
                                                    <PlusLg size={10} />
                                                </button>
                                            </span>
                                        </div>
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
                    <Modal.Title>Add value</Modal.Title>
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
                            <Button type="submit" variant="primary" disabled={submitting}>
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
