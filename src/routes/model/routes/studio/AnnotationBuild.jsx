import axios from "axios";
import { useContext, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Dropdown, Form, InputGroup, Row } from "react-bootstrap";
import { Bookmarks  , BracesAsterisk, PencilSquare, Download, PlusLg, Quote, Tags, Upload, Diagram2 } from "react-bootstrap-icons";
import { useParams, useSearchParams } from "react-router-dom";
import { ModelContext } from "../../../../contexts/ModelContext";
import { UserContext } from "../../../../contexts/UserContext";
import DeleteConfirmationModal from "../../../../shared/components/DeleteConfirmationModal";
import MetricsStrip from "../../../../shared/components/MetricsStrip";
import SplitPane from "../../../../shared/components/SplitPane";
import { COLORS, nextEntityColor } from "../../../../shared/components/entityColors";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import { parseInline, formatInline } from "../../../../shared/utils/inline";
import useDebounce from "../../../../shared/hooks/useDebounce";
import AnnotationWorkspace from "./components/AnnotationWorkspace";
import EntitiesPanel from "./components/EntitiesPanel";
import EntityFormModal from "./components/EntityFormModal";
import EntityValues from "./components/EntityValues";
import ImportDatasetModal, { DATASET_FORMATS, NLU_DATASET_FORMATS } from "./components/ImportDatasetModal";

const PER_PAGE = 10;

// Default highlight palette for new entities; shared with Test so both
// surfaces use the same colours, and mirrors the server's fallback.
const ENTITY_COLORS = COLORS;

// Dataset-health items for the shared MetricsStrip: intents (LU only), the
// entity/slot registry size, utterances, annotated coverage and span total.
const statItems = (stats, nlu) => {
    const annotatedPct = stats.utterances > 0 ? Math.round((stats.annotated / stats.utterances) * 100) : 0;
    return [
        ...(nlu ? [{ label: "Intents", value: stats.intents, icon: <Bookmarks /> }] : []),
        { label: nlu ? "Slots" : "Entities", value: stats.entities, icon: nlu ? <Diagram2/> : <Tags /> },
        { label: "Utterances", value: stats.utterances, icon: <Quote /> },
        { label: "Annotated", value: `${annotatedPct}%`, sub: `${stats.annotated} / ${stats.utterances}`, icon: <PencilSquare /> },
        { label: nlu ? "Slot spans" : "Entity spans", value: stats.spans, icon: <BracesAsterisk /> }
    ];
};

// Build page for named entity recognition models: the entity registry and the
// annotation workspace side by side. Utterances are model-scoped and carry
// annotated spans instead of belonging to one intent.
// Also serves as the Slots sub-tab of a language understanding model, where
// the registry is the shared entities, each row shows its intent read-only,
// and new utterances are authored under an intent in the Intents tab instead.
const AnnotationBuild = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const nlu = model?.kind === "natural_language_understanding";
    // The entity drill-in (?entity=<id>) opens the value catalogue —
    // add/edit/delete values and synonyms — mirroring the language
    // understanding Entities tab; the breadcrumb (Model.jsx) walks back out.
    const [searchParams] = useSearchParams();
    const entityId = searchParams.get("entity");
    const [alert, setAlert] = useState(null);

    const [entities, setEntities] = useState([]);
    const [entitiesLoading, setEntitiesLoading] = useState(false);
    const [entitiesRefresh, setEntitiesRefresh] = useState(0);
    const [entityQuery, setEntityQuery] = useState("");

    const [showEntityForm, setShowEntityForm] = useState(false);
    const [currentEntity, setCurrentEntity] = useState(null);
    const [entityName, setEntityName] = useState("");
    const [entityColor, setEntityColor] = useState(ENTITY_COLORS[0]);
    const [entityDescription, setEntityDescription] = useState("");
    const [entityListType, setEntityListType] = useState("open");
    const [entityToDelete, setEntityToDelete] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [query, setQuery] = useState("");
    const [utterances, setUtterances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [utterancesRefresh, setUtterancesRefresh] = useState(0);

    const [showImport, setShowImport] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importSummary, setImportSummary] = useState(null);
    const [exporting, setExporting] = useState(false);

    const [stats, setStats] = useState({ entities: 0, utterances: 0, annotated: 0, spans: 0 });

    const debouncedQuery = useDebounce(query, 500);
    const headers = { Authorization: `Bearer ${user?.token}` };

    // Cheap dictionary assist (AN-8): the entity each surface string was most
    // recently labelled as, over the loaded utterances. Lets the picker offer a
    // likely entity when the same phrase is selected again. Best-effort — it
    // only sees what's loaded, not the whole dataset.
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

    // --- Entities -----------------------------------------------------------

    const closeEntityForm = () => {
        setShowEntityForm(false);
        setCurrentEntity(null);
        setValidated(false);
        setSubmitting(false);
    };

    const handleOpenCreateEntity = () => {
        setCurrentEntity(null);
        setEntityName("");
        // Default to a colour no existing entity uses, so each is distinct.
        setEntityColor(nextEntityColor(entities.map((entity) => entity.color)));
        setEntityDescription("");
        setEntityListType("open");
        setValidated(false);
        setShowEntityForm(true);
    };

    const handleOpenEditEntity = (entity) => {
        setCurrentEntity(entity);
        setEntityName(entity.name);
        setEntityColor(entity.color || ENTITY_COLORS[0]);
        setEntityDescription(entity.description || "");
        setEntityListType(entity.list_type || "open");
        setValidated(false);
        setShowEntityForm(true);
    };

    const handleSubmitEntity = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) {
            e.stopPropagation();
            setValidated(true);
            return;
        }
        setValidated(true);

        const data = new FormData();
        data.append("name", entityName.trim());
        data.append("color", entityColor);
        data.append("description", entityDescription);
        // Only entities carry an open/closed value-space type.
        if (!nlu) data.append("list_type", entityListType);

        try {
            setSubmitting(true);
            if (currentEntity) {
                await axios.put(`/api/models/${modelId}/entities/${currentEntity.id}`, data, { headers });
                // Annotations embed the entity name and colour; refresh them.
                setUtterancesRefresh((n) => n + 1);
            } else {
                await axios.post(`/api/models/${modelId}/entities`, data, { headers });
            }
            setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        } finally {
            closeEntityForm();
        }
    };

    const handleDeleteEntity = async () => {
        try {
            setSubmitting(true);
            await axios.delete(`/api/models/${modelId}/entities/${entityToDelete.id}`, { headers });
            setEntitiesRefresh((n) => n + 1);
            setUtterancesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        } finally {
            setEntityToDelete(null);
            setSubmitting(false);
        }
    };

    // --- Utterances ---------------------------------------------------------

    const handleCreateUtterance = async (value) => {
        const raw = value.trim();
        if (raw === "") return;

        if (nlu) {
            // Every language understanding utterance is created under an
            // intent, so authoring happens in the Intents tab; this field
            // only searches the shared set.
            setAlert({ variant: "warning", message: "Create utterances under an intent in the Intents tab; this field searches the shared utterances." });
            return;
        }

        const { text, spans, error } = parseInline(raw);
        if (error) {
            setAlert({ variant: "danger", message: error });
            return;
        }
        if (text.trim() === "") return;

        const unknown = [...new Set(
            spans.map((span) => span.entity).filter((name) => !entities.some((entity) => entity.name === name))
        )];
        if (unknown.length > 0) {
            setAlert({ variant: "danger", message: `Unknown entit${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}. Define them first.` });
            return;
        }

        try {
            let response = await axios.post(`/api/models/${modelId}/utterances`, { text }, { headers });
            let created = response.data;
            for (const span of spans) {
                const entity = entities.find((candidate) => candidate.name === span.entity);
                response = await axios.post(
                    `/api/models/${modelId}/utterances/${created.id}/tags`,
                    { entity_id: entity.id, start: span.start, end: span.end },
                    { headers }
                );
                created = response.data;
            }

            setUtterances((previous) => [created, ...previous]);
            setTotal((previous) => previous + 1);
            setQuery("");
            if (spans.length > 0) setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    const handleAnnotate = async (utteranceId, span) => {
        try {
            const response = await axios.post(
                `/api/models/${modelId}/utterances/${utteranceId}/tags`,
                span,
                { headers }
            );
            replaceUtterance(response.data);
            setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    // Seamless in-place edit: the row hands back inline {entity: value} markup,
    // so text and annotations are updated together in one round trip. Returns
    // whether the row may leave edit mode (false keeps the draft on a bad edit).
    const handleEditUtterance = async (utteranceId, raw) => {
        const original = utterances.find((utterance) => utterance.id === utteranceId);
        if (!original) return true;

        const { text, spans, error } = parseInline(raw);
        if (error) {
            setAlert({ variant: "danger", message: error });
            return false;
        }
        if (text.trim() === "") return false;

        const unknown = [...new Set(
            spans.map((span) => span.entity).filter((name) => !entities.some((entity) => entity.name === name))
        )];
        if (unknown.length > 0) {
            setAlert({ variant: "danger", message: `Unknown entit${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}. Define them first.` });
            return false;
        }

        // Nothing changed (same text and same spans) — close without a request.
        if (raw.trim() === formatInline(original.text, original.annotations).trim()) return true;

        try {
            const annotations = spans.map((span) => ({ label: span.entity, start: span.start, end: span.end }));
            const response = await axios.put(
                `/api/models/${modelId}/utterances/${utteranceId}`,
                { text, annotations },
                { headers }
            );
            replaceUtterance(response.data);
            // An edit can move spans and change per-entity counts.
            setEntitiesRefresh((n) => n + 1);
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
            setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    // --- Import / export ----------------------------------------------------

    const handleImport = async (file, format) => {
        const data = new FormData();
        data.append("format", format);
        data.append("dataset", file);
        try {
            setImporting(true);
            const response = await axios.post(`/api/models/${modelId}/tags/import`, data, { headers });
            setImportSummary(response.data);
            // Pull in the new utterances and any auto-created entities.
            setUtterancesRefresh((n) => n + 1);
            setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        } finally {
            setImporting(false);
        }
    };

    const closeImport = () => {
        setShowImport(false);
        setImportSummary(null);
    };

    const handleExport = async (format) => {
        try {
            setExporting(true);
            const response = await axios.get(`/api/models/${modelId}/tags/export`, {
                params: { format },
                responseType: "blob",
                headers
            });
            const extension = { json: "jsonl", conll: "conll", csv: "csv" }[format] || "txt";
            downloadBlob(response.data, `${modelId}-${format}.${extension}`);
        } catch (error) {
            showError(error);
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        if (user && modelId) {
            const getEntities = async () => {
                try {
                    setEntitiesLoading(entities.length === 0);
                    const params = { per_page: 100 };
                    const response = await axios.get(`/api/models/${modelId}/entities`, { params, headers });
                    setEntities(response.data.entities);
                } catch (error) {
                    showError(error);
                } finally {
                    setEntitiesLoading(false);
                }
            };
            getEntities();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, entitiesRefresh, nlu]);

    // Resets the scrollable list to its first chunk whenever the search
    // query or an entity/annotation change invalidates what's loaded.
    useEffect(() => {
        if (user && modelId) {
            const getUtterances = async () => {
                try {
                    setLoading(true);
                    const params = { page: 1, per_page: PER_PAGE };
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
    }, [user, modelId, debouncedQuery, utterancesRefresh]);

    // Dataset-health metrics for the overview strip. Refreshed whenever the
    // utterance total or an entity/annotation change (entitiesRefresh) makes the
    // current counts stale — covers create, delete, annotate, edit and import.
    useEffect(() => {
        if (user && modelId) {
            const getStats = async () => {
                try {
                    const response = await axios.get(`/api/models/${modelId}/tags/stats`, { headers });
                    setStats(response.data);
                } catch (error) {
                    showError(error);
                }
            };
            getStats();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, total, entitiesRefresh]);

    // Appends the next chunk as the workspace list is scrolled to its end.
    const handleLoadMoreUtterances = async () => {
        if (loading || loadingMore || utterances.length >= total) return;
        const nextPage = page + 1;
        try {
            setLoadingMore(true);
            const params = { page: nextPage, per_page: PER_PAGE };
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

    // Drilled into one entity: render just its value catalogue — the
    // breadcrumb is the way back out, exactly like the language
    // understanding drill-ins.
    if (!nlu && entityId) {
        return <EntityValues key={entityId} entityId={entityId} />;
    }

    return (
        <>
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <MetricsStrip items={statItems(stats, nlu)} />
            <SplitPane
                className="mt-4"
                left={(
                    <>
                        <InputGroup className="mb-3">
                            <Button
                                variant="primary"
                                onClick={handleOpenCreateEntity}
                            >
                                <PlusLg className="me-1" />
                                Create
                            </Button>
                            <Form.Control
                                type="text"
                                placeholder={nlu ? "search for slots..." : "search for entities..."}
                                value={entityQuery}
                                onChange={(e) => setEntityQuery(e.target.value)}
                            />
                        </InputGroup>
                        <EntitiesPanel
                            loading={entitiesLoading}
                            entities={entities}
                            query={entityQuery}
                            noun={nlu ? "slot" : "entity"}
                            linkOf={nlu ? undefined : (entity) => `/models/${modelId}/build?entity=${entity.id}`}
                            onEdit={handleOpenEditEntity}
                            onDelete={setEntityToDelete}
                        />
                    </>
                )}
                right={(
                    <>
                        <div className="d-flex gap-2 mb-3">
                            <Form className="flex-grow-1" style={{ minWidth: 0 }}>
                                <Form.Control
                                    type="text"
                                    placeholder={nlu ? "search the shared utterances..." : "enter or search an utterance..."}
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
                            <Button
                                variant="light"
                                className="border d-inline-flex align-items-center flex-shrink-0"
                                onClick={() => setShowImport(true)}
                                title="Import a pre-annotated dataset"
                            >
                                <Upload className="me-1" />
                                <span className="d-none d-sm-inline">Import</span>
                            </Button>
                            <Dropdown>
                                <Dropdown.Toggle
                                    variant="light"
                                    className="border d-inline-flex align-items-center flex-shrink-0"
                                    disabled={exporting || total === 0}
                                    title="Export the dataset"
                                >
                                    <Download className="me-1" />
                                    <span className="d-none d-sm-inline">Export</span>
                                </Dropdown.Toggle>
                                <Dropdown.Menu align="end">
                                    {(nlu ? NLU_DATASET_FORMATS : DATASET_FORMATS).map((item) => (
                                        <Dropdown.Item key={item.value} onClick={() => handleExport(item.value)}>
                                            {item.label}
                                        </Dropdown.Item>
                                    ))}
                                </Dropdown.Menu>
                            </Dropdown>
                        </div>
                        <AnnotationWorkspace
                            loading={loading}
                            loadingMore={loadingMore}
                            utterances={utterances}
                            total={total}
                            query={query}
                            entities={entities}
                            suggestions={suggestions}
                            showIntent={nlu}
                            onAnnotate={handleAnnotate}
                            onEdit={handleEditUtterance}
                            onDelete={handleDeleteUtterance}
                            onAlert={(message) => setAlert({ variant: "warning", message })}
                            onLoadMore={handleLoadMoreUtterances}
                        />
                    </>
                )}
            />
            <EntityFormModal
                show={showEntityForm}
                title={currentEntity
                    ? (nlu ? "Edit slot" : "Edit entity")
                    : (nlu ? "Create slot" : "Create entity")}
                validated={validated}
                submitting={submitting}
                name={entityName}
                color={entityColor}
                description={entityDescription}
                listType={entityListType}
                onHide={closeEntityForm}
                onSubmit={handleSubmitEntity}
                onNameChange={setEntityName}
                onColorChange={setEntityColor}
                onDescriptionChange={setEntityDescription}
                onListTypeChange={nlu ? undefined : setEntityListType}
            />
            <DeleteConfirmationModal
                show={entityToDelete != null}
                title={nlu ? "Delete slot" : "Delete entity"}
                items={entityToDelete ? [
                    `${entityToDelete.name} (removes ${entityToDelete.annotations_count} annotated span${entityToDelete.annotations_count === 1 ? "" : "s"})`
                ] : []}
                itemType={nlu ? "slot" : "entity"}
                submitting={submitting}
                onHide={() => setEntityToDelete(null)}
                onDelete={handleDeleteEntity}
            />
            <ImportDatasetModal
                show={showImport}
                submitting={importing}
                summary={importSummary}
                formats={nlu ? NLU_DATASET_FORMATS : DATASET_FORMATS}
                onHide={closeImport}
                onSubmit={handleImport}
            />
        </>
    );
};

export default AnnotationBuild;
