import axios from "axios";
import { useContext, useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, InputGroup } from "react-bootstrap";
import { BracesAsterisk, Diagram2, PencilSquare, PlusLg, Quote } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../../contexts/UserContext";
import DeleteConfirmationModal from "../../../../../shared/components/DeleteConfirmationModal";
import MetricsStrip from "../../../../../shared/components/MetricsStrip";
import SplitPane from "../../../../../shared/components/SplitPane";
import { parseInline, formatInline } from "../../../../../shared/utils/inline";
import useDebounce from "../../../../../shared/hooks/useDebounce";
import AnnotationWorkspace from "./AnnotationWorkspace";
import EntitiesPanel from "./EntitiesPanel";
import SlotFormModal, { NEW_ENTITY } from "./SlotFormModal";

const PER_PAGE = 10;

// The drill-in workspace of one intent (IN-2): author utterances under it,
// define its slots (each mapping to an entity from the global registry) and
// tag slot spans on its utterances. Mirrors the named entity recognition
// Build page — the same overview strip, two-pane split and workspace
// components — with slots standing in for entities: the registry chips
// (reusing EntitiesPanel) show each slot's mapped entity, and the "entities"
// fed to the annotation picker are this intent's slots, each inheriting its
// entity colour. The intent name shows in the page breadcrumb (Model.jsx).
const IntentWorkspace = ({ intentId }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const [alert, setAlert] = useState(null);

    const [slots, setSlots] = useState([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsRefresh, setSlotsRefresh] = useState(0);
    const [slotQuery, setSlotQuery] = useState("");
    const [entities, setEntities] = useState([]);
    const [stats, setStats] = useState({ slots: 0, utterances: 0, annotated: 0, spans: 0 });

    const [showSlotForm, setShowSlotForm] = useState(false);
    const [currentSlot, setCurrentSlot] = useState(null);
    const [slotName, setSlotName] = useState("");
    const [slotEntityId, setSlotEntityId] = useState("");
    const [newEntityName, setNewEntityName] = useState("");
    const [slotToDelete, setSlotToDelete] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [query, setQuery] = useState("");
    const [utterances, setUtterances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [utterancesRefresh, setUtterancesRefresh] = useState(0);

    const debouncedQuery = useDebounce(query, 500);
    const headers = { Authorization: `Bearer ${user?.token}` };

    // The picker/highlight registry: this intent's slots, shaped like the
    // entity rows AnnotationWorkspace expects, plus each slot's entity so
    // the picker can show the role's type beside its name.
    const pickerSlots = useMemo(() => slots.map((slot) => ({
        id: slot.id,
        name: slot.name,
        color: slot.color,
        entity: slot.entity,
        annotations_count: slot.annotations_count,
        description: slot.entity ? `${slot.name} → ${slot.entity.name}` : undefined
    })), [slots]);

    // The slot each surface string was most recently tagged as, over the
    // loaded utterances — the picker's dictionary assist.
    const suggestions = useMemo(() => {
        const map = {};
        utterances.forEach((utterance) => {
            (utterance.annotations || []).forEach((annotation) => {
                if (annotation.value) map[annotation.value.toLowerCase()] = annotation.label;
            });
        });
        return map;
    }, [utterances]);

    const showError = (error, fallback = "Something went wrong.") => {
        setAlert({ variant: "danger", message: error?.response?.data?.error || fallback });
    };

    const replaceUtterance = (updated) => {
        setUtterances((previous) => previous.map((utterance) => (
            utterance.id === updated.id ? updated : utterance
        )));
    };

    // --- Slots ----------------------------------------------------------

    const closeSlotForm = () => {
        setShowSlotForm(false);
        setCurrentSlot(null);
        setValidated(false);
        setSubmitting(false);
    };

    const handleOpenCreateSlot = () => {
        setCurrentSlot(null);
        setSlotName("");
        setSlotEntityId("");
        setNewEntityName("");
        setValidated(false);
        setShowSlotForm(true);
    };

    const handleOpenEditSlot = (slot) => {
        setCurrentSlot(slot);
        setSlotName(slot.name);
        setSlotEntityId(slot.entity ? String(slot.entity.id) : "");
        setNewEntityName("");
        setValidated(false);
        setShowSlotForm(true);
    };

    const handleSubmitSlot = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) {
            e.stopPropagation();
            setValidated(true);
            return;
        }
        setValidated(true);

        try {
            setSubmitting(true);
            let entityId = slotEntityId;
            if (entityId === NEW_ENTITY) {
                // Create-on-the-fly (IN-3): define the entity first, then
                // point the slot at it.
                const data = new FormData();
                data.append("name", newEntityName.trim());
                const response = await axios.post(`/api/models/${modelId}/entities`, data, { headers });
                entityId = String(response.data.id);
            }
            const payload = { name: slotName.trim(), entity_id: Number(entityId) };
            if (currentSlot) {
                await axios.put(`/api/models/${modelId}/slots/${currentSlot.id}`, payload, { headers });
                // Annotations embed the slot name and colour; refresh them.
                setUtterancesRefresh((n) => n + 1);
            } else {
                await axios.post(`/api/models/${modelId}/slots`, { ...payload, intent_id: Number(intentId) }, { headers });
            }
            setSlotsRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        } finally {
            closeSlotForm();
        }
    };

    const handleDeleteSlot = async () => {
        try {
            setSubmitting(true);
            await axios.delete(`/api/models/${modelId}/slots/${slotToDelete.id}`, { headers });
            setSlotsRefresh((n) => n + 1);
            setUtterancesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        } finally {
            setSlotToDelete(null);
            setSubmitting(false);
        }
    };

    // --- Utterances -----------------------------------------------------

    const unknownSlots = (spans) => [...new Set(
        spans.map((span) => span.entity).filter((name) => !slots.some((slot) => slot.name === name))
    )];

    const handleCreateUtterance = async (value) => {
        const raw = value.trim();
        if (raw === "") return;

        const { text, spans, error } = parseInline(raw);
        if (error) {
            setAlert({ variant: "danger", message: error });
            return;
        }
        if (text.trim() === "") return;

        const unknown = unknownSlots(spans);
        if (unknown.length > 0) {
            setAlert({ variant: "danger", message: `Unknown slot${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Define them in the slots panel first.` });
            return;
        }

        try {
            let response = await axios.post(
                `/api/models/${modelId}/utterances`,
                { text, intent_id: Number(intentId) },
                { headers }
            );
            let created = response.data;
            for (const span of spans) {
                const slot = slots.find((candidate) => candidate.name === span.entity);
                response = await axios.post(
                    `/api/models/${modelId}/utterances/${created.id}/tags`,
                    { slot_id: slot.id, start: span.start, end: span.end },
                    { headers }
                );
                created = response.data;
            }
            setUtterances((previous) => [created, ...previous]);
            setTotal((previous) => previous + 1);
            setQuery("");
            if (spans.length > 0) setSlotsRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    const handleAnnotate = async (utteranceId, span) => {
        try {
            // The picker hands back its row id as entity_id; here the rows
            // are this intent's slots, so it is the slot id.
            const response = await axios.post(
                `/api/models/${modelId}/utterances/${utteranceId}/tags`,
                { slot_id: span.entity_id, start: span.start, end: span.end },
                { headers }
            );
            replaceUtterance(response.data);
            setSlotsRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    const handleEditUtterance = async (utteranceId, raw) => {
        const original = utterances.find((utterance) => utterance.id === utteranceId);
        if (!original) return true;

        const { text, spans, error } = parseInline(raw);
        if (error) {
            setAlert({ variant: "danger", message: error });
            return false;
        }
        if (text.trim() === "") return false;

        const unknown = unknownSlots(spans);
        if (unknown.length > 0) {
            setAlert({ variant: "danger", message: `Unknown slot${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Define them in the slots panel first.` });
            return false;
        }

        if (raw.trim() === formatInline(original.text, original.annotations).trim()) return true;

        try {
            const annotations = spans.map((span) => ({ label: span.entity, start: span.start, end: span.end }));
            const response = await axios.put(
                `/api/models/${modelId}/utterances/${utteranceId}`,
                { text, annotations },
                { headers }
            );
            replaceUtterance(response.data);
            setSlotsRefresh((n) => n + 1);
            return true;
        } catch (error) {
            showError(error);
            return false;
        }
    };

    const handleDeleteUtterance = async (utteranceId) => {
        try {
            await axios.delete(`/api/models/${modelId}/utterances/${utteranceId}`, { headers });
            setUtterances((previous) => previous.filter((utterance) => utterance.id !== utteranceId));
            setTotal((previous) => previous - 1);
            setSlotsRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    // --- Data loading ----------------------------------------------------

    // Intent-scoped dataset-health counts for the overview strip. Refreshed
    // whenever the utterance total or a slot/annotation change makes them
    // stale — covers create, delete, annotate, edit and slot changes.
    useEffect(() => {
        if (user && modelId && intentId) {
            const getStats = async () => {
                try {
                    const response = await axios.get(`/api/models/${modelId}/tags/stats`, {
                        params: { intent: intentId }, headers
                    });
                    setStats(response.data);
                } catch (error) {
                    showError(error);
                }
            };
            getStats();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, intentId, slotsRefresh, total]);

    useEffect(() => {
        if (user && modelId && intentId) {
            const getSlots = async () => {
                try {
                    setSlotsLoading(slots.length === 0);
                    const response = await axios.get(`/api/models/${modelId}/slots`, {
                        params: { intent: intentId }, headers
                    });
                    setSlots(response.data.slots);
                } catch (error) {
                    showError(error);
                } finally {
                    setSlotsLoading(false);
                }
            };
            const getEntities = async () => {
                try {
                    const response = await axios.get(`/api/models/${modelId}/entities`, {
                        params: { per_page: 100 }, headers
                    });
                    setEntities(response.data.entities);
                } catch (error) {
                    showError(error);
                }
            };
            getSlots();
            getEntities();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, intentId, slotsRefresh]);

    useEffect(() => {
        if (user && modelId && intentId) {
            const getUtterances = async () => {
                try {
                    setLoading(true);
                    const params = { page: 1, per_page: PER_PAGE, intent: intentId };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${modelId}/utterances`, { params, headers });
                    setUtterances(response.data.utterances);
                    setTotal(response.data.total);
                    setPage(1);
                } catch (error) {
                    showError(error);
                } finally {
                    setLoading(false);
                }
            };
            getUtterances();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, intentId, debouncedQuery, utterancesRefresh]);

    const handleLoadMoreUtterances = async () => {
        if (loading || loadingMore || utterances.length >= total) return;
        const nextPage = page + 1;
        try {
            setLoadingMore(true);
            const params = { page: nextPage, per_page: PER_PAGE, intent: intentId };
            if (debouncedQuery !== "") params.query = debouncedQuery;
            const response = await axios.get(`/api/models/${modelId}/utterances`, { params, headers });
            setUtterances((previous) => [...previous, ...response.data.utterances]);
            setTotal(response.data.total);
            setPage(nextPage);
        } catch (error) {
            showError(error);
        } finally {
            setLoadingMore(false);
        }
    };

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
                    { label: "Slots", value: stats.slots, icon: <Diagram2 /> },
                    { label: "Utterances", value: stats.utterances, icon: <Quote /> },
                    {
                        label: "Annotated",
                        value: `${stats.utterances > 0 ? Math.round((stats.annotated / stats.utterances) * 100) : 0}%`,
                        sub: `${stats.annotated} / ${stats.utterances}`,
                        icon: <PencilSquare />
                    },
                    { label: "Slot spans", value: stats.spans, icon: <BracesAsterisk /> }
                ]}
            />
            <SplitPane
                className="mt-4"
                left={(
                    <>
                        <InputGroup className="mb-3">
                            <Button variant="primary" onClick={handleOpenCreateSlot}>
                                <PlusLg className="me-1" />
                                Create slot
                            </Button>
                            <Form.Control
                                type="text"
                                placeholder="search for slots..."
                                value={slotQuery}
                                onChange={(e) => setSlotQuery(e.target.value)}
                            />
                        </InputGroup>
                        <EntitiesPanel
                            loading={slotsLoading}
                            entities={slots}
                            query={slotQuery}
                            noun="slot"
                            titleOf={(slot) => (slot.entity ? `${slot.name} → ${slot.entity.name}` : slot.name)}
                            linkOf={(slot) => `/models/${modelId}/build?tab=entities&entity=${slot.entity?.id}`}
                            onEdit={handleOpenEditSlot}
                            onDelete={setSlotToDelete}
                        />
                    </>
                )}
                right={(
                    <>
                        <Form className="mb-3">
                            <Form.Control
                                type="text"
                                placeholder="enter an utterance — wrap phrases as {slot: value} — or search..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleCreateUtterance(e.target.value);
                                    }
                                }}
                            />
                        </Form>
                        <AnnotationWorkspace
                            loading={loading}
                            loadingMore={loadingMore}
                            utterances={utterances}
                            total={total}
                            query={query}
                            entities={pickerSlots}
                            suggestions={suggestions}
                            showIntent={false}
                            onAnnotate={handleAnnotate}
                            onEdit={handleEditUtterance}
                            onDelete={handleDeleteUtterance}
                            onAlert={(message) => setAlert({ variant: "warning", message })}
                            onLoadMore={handleLoadMoreUtterances}
                        />
                    </>
                )}
            />
            <SlotFormModal
                show={showSlotForm}
                title={currentSlot ? "Edit slot" : "Create slot"}
                validated={validated}
                submitting={submitting}
                name={slotName}
                entities={entities}
                entityId={slotEntityId}
                newEntityName={newEntityName}
                onHide={closeSlotForm}
                onSubmit={handleSubmitSlot}
                onNameChange={setSlotName}
                onEntityChange={setSlotEntityId}
                onNewEntityNameChange={setNewEntityName}
            />
            <DeleteConfirmationModal
                show={slotToDelete != null}
                title="Delete slot"
                items={slotToDelete ? [
                    `${slotToDelete.name} (removes ${slotToDelete.annotations_count} annotated span${slotToDelete.annotations_count === 1 ? "" : "s"})`
                ] : []}
                itemType="slot"
                submitting={submitting}
                onHide={() => setSlotToDelete(null)}
                onDelete={handleDeleteSlot}
            />
        </>
    );
};

export default IntentWorkspace;
