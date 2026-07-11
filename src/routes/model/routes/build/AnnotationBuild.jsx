import axios from "axios";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Col, Dropdown, Form, InputGroup, Row } from "react-bootstrap";
import { BookmarkStar, CheckCircle, Download, GripVertical, PlusLg, Quote, Tags, Upload } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import DeleteConfirmationModal from "../../../../shared/components/DeleteConfirmationModal";
import { COLORS, nextEntityColor } from "../../../../shared/components/entityColors";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import { parseInline, formatInline } from "../../../../shared/utils/inline";
import useDebounce from "../../../../shared/hooks/useDebounce";
import AnnotationWorkspace from "./components/AnnotationWorkspace";
import EntitiesPanel from "./components/EntitiesPanel";
import EntityFormModal from "./components/EntityFormModal";
import ImportDatasetModal, { DATASET_FORMATS } from "./components/ImportDatasetModal";

const PER_PAGE = 10;

// Entities/utterances split, as the entities panel's width percentage.
// Mirrors the Test page's request/response drag handle (same mechanics and
// gutter), just narrower bounds since entities is the secondary panel here.
const DEFAULT_SPLIT = 34;
const MIN_SPLIT = 22;
const MAX_SPLIT = 55;
const SPLIT_GUTTER = 16;

// Default highlight palette for new entities; shared with Test so both
// surfaces use the same colours, and mirrors the server's fallback.
const ENTITY_COLORS = COLORS;

// A compact overview strip of dataset health, mirroring the metric strips in
// History and the analyse page. Rendered above the workspace so an annotator
// sees coverage at a glance before drilling in.
const MetricsStrip = ({ stats }) => {
    const annotatedPct = stats.utterances > 0 ? Math.round((stats.annotated / stats.utterances) * 100) : 0;
    const items = [
        { label: "Entities", value: stats.entities, icon: <Tags /> },
        { label: "Utterances", value: stats.utterances, icon: <Quote /> },
        {
            label: "Annotated",
            value: `${annotatedPct}%`,
            sub: `${stats.annotated} / ${stats.utterances}`,
            icon: <CheckCircle />
        },
        { label: "Entity spans", value: stats.spans, icon: <BookmarkStar /> }
    ];
    return (
        <Row className="g-3 mt-1">
            {items.map((item, index) => (
                <Col key={index} xs={6} md={3} lg={true}>
                    <Card className="h-100">
                        <Card.Body className="p-3 d-flex align-items-center">
                            <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                <div className="text-muted small fw-bold" style={{ fontSize: "0.65rem" }}>{item.label}</div>
                                <div className="text-body-emphasis small fw-medium text-truncate">
                                    {item.value ?? "-"}
                                    {item.sub && <span className="text-muted fw-normal ms-1">{item.sub}</span>}
                                </div>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            ))}
        </Row>
    );
};

// Build page for named entity recognition models: the entity registry and the
// annotation workspace side by side. Entities are Label rows; utterances are
// model-scoped and carry annotated spans instead of belonging to one label.
const AnnotationBuild = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
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

    // Draggable split between the entities and utterances panels. The gutter
    // (and the split itself) only applies from the lg breakpoint up, where
    // the two panels sit side by side; below it they stack full width.
    const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT);
    const [isWide, setIsWide] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(min-width: 992px)").matches
    );
    const splitRef = useRef(null);
    const draggingRef = useRef(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(min-width: 992px)");
        const handleChange = (event) => setIsWide(event.matches);
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        const handleMove = (event) => {
            if (!draggingRef.current || !splitRef.current) return;
            const rect = splitRef.current.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const pct = ((clientX - rect.left) / rect.width) * 100;
            setSplitPct(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)));
        };
        const stopDrag = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", stopDrag);
        window.addEventListener("touchmove", handleMove, { passive: false });
        window.addEventListener("touchend", stopDrag);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", stopDrag);
            window.removeEventListener("touchmove", handleMove);
            window.removeEventListener("touchend", stopDrag);
        };
    }, []);

    const startDrag = (event) => {
        draggingRef.current = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        event.preventDefault();
    };

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
        setValidated(false);
        setShowEntityForm(true);
    };

    const handleOpenEditEntity = (entity) => {
        setCurrentEntity(entity);
        setEntityName(entity.name);
        setEntityColor(entity.color || ENTITY_COLORS[0]);
        setEntityDescription(entity.description || "");
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

        try {
            setSubmitting(true);
            if (currentEntity) {
                await axios.put(`/api/models/${modelId}/labels/${currentEntity.id}`, data, { headers });
                // Annotations embed the entity name and colour; refresh them.
                setUtterancesRefresh((n) => n + 1);
            } else {
                await axios.post(`/api/models/${modelId}/labels`, data, { headers });
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
            await axios.delete(`/api/models/${modelId}/labels/${entityToDelete.id}`, { headers });
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
                    `/api/models/${modelId}/utterances/${created.id}/annotations`,
                    { label_id: entity.id, start: span.start, end: span.end },
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
                `/api/models/${modelId}/utterances/${utteranceId}/annotations`,
                span,
                { headers }
            );
            replaceUtterance(response.data);
            setEntitiesRefresh((n) => n + 1);
        } catch (error) {
            showError(error);
        }
    };

    const handleRemoveAnnotation = async (utteranceId, annotationId) => {
        try {
            const response = await axios.delete(
                `/api/models/${modelId}/utterances/${utteranceId}/annotations/${annotationId}`,
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
            const response = await axios.post(`/api/models/${modelId}/annotations/import`, data, { headers });
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
            const response = await axios.get(`/api/models/${modelId}/annotations/export`, {
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
                    const response = await axios.get(`/api/models/${modelId}/labels`, { params, headers });
                    setEntities(response.data.labels);
                } catch (error) {
                    showError(error);
                } finally {
                    setEntitiesLoading(false);
                }
            };
            getEntities();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, entitiesRefresh]);

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
                    const response = await axios.get(`/api/models/${modelId}/annotations/stats`, { headers });
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

    return (
        <>
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <MetricsStrip stats={stats} />
            <div
                ref={splitRef}
                className={`d-flex mt-4 ${isWide ? "flex-row align-items-stretch" : "flex-column gap-3"}`}
            >
                <div
                    className="d-flex flex-column"
                    style={isWide
                        ? { flex: `0 0 calc(${splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                        : { width: "100%" }}
                >
                    <InputGroup className="mb-3">
                        <Button
                            variant="light"
                            className="border"
                            onClick={handleOpenCreateEntity}
                        >
                            <PlusLg className="me-1" />
                            Create
                        </Button>
                        <Form.Control
                            type="text"
                            placeholder="search for entities..."
                            value={entityQuery}
                            onChange={(e) => setEntityQuery(e.target.value)}
                        />
                    </InputGroup>
                    <EntitiesPanel
                        loading={entitiesLoading}
                        entities={entities}
                        query={entityQuery}
                        onEdit={handleOpenEditEntity}
                        onDelete={setEntityToDelete}
                    />
                </div>

                {isWide && (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={startDrag}
                        onTouchStart={startDrag}
                        onDoubleClick={() => setSplitPct(DEFAULT_SPLIT)}
                        title="Drag to resize · double-click to reset"
                        className="d-flex align-items-center justify-content-center flex-shrink-0 text-body-secondary"
                        style={{ width: `${SPLIT_GUTTER}px`, cursor: "col-resize", touchAction: "none", alignSelf: "stretch" }}
                    >
                        <GripVertical size={16} />
                    </div>
                )}

                <div
                    className="d-flex flex-column"
                    style={isWide
                        ? { flex: `1 1 calc(${100 - splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                        : { width: "100%" }}
                >
                    <div className="d-flex gap-2 mb-3">
                        <Form className="flex-grow-1" style={{ minWidth: 0 }}>
                            <Form.Control
                                type="text"
                                placeholder="enter or search an utterance..."
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
                                {DATASET_FORMATS.map((item) => (
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
                        onAnnotate={handleAnnotate}
                        onRemoveAnnotation={handleRemoveAnnotation}
                        onEdit={handleEditUtterance}
                        onDelete={handleDeleteUtterance}
                        onAlert={(message) => setAlert({ variant: "warning", message })}
                        onLoadMore={handleLoadMoreUtterances}
                    />
                </div>
            </div>
            <EntityFormModal
                show={showEntityForm}
                title={currentEntity ? "Edit entity" : "Create entity"}
                validated={validated}
                submitting={submitting}
                name={entityName}
                color={entityColor}
                description={entityDescription}
                onHide={closeEntityForm}
                onSubmit={handleSubmitEntity}
                onNameChange={setEntityName}
                onColorChange={setEntityColor}
                onDescriptionChange={setEntityDescription}
            />
            <DeleteConfirmationModal
                show={entityToDelete != null}
                title="Delete entity"
                items={entityToDelete ? [
                    `${entityToDelete.name} (removes ${entityToDelete.annotations_count} annotated span${entityToDelete.annotations_count === 1 ? "" : "s"})`
                ] : []}
                itemType="entity"
                submitting={submitting}
                onHide={() => setEntityToDelete(null)}
                onDelete={handleDeleteEntity}
            />
            <ImportDatasetModal
                show={showImport}
                submitting={importing}
                summary={importSummary}
                onHide={closeImport}
                onSubmit={handleImport}
            />
        </>
    );
};

export default AnnotationBuild;
