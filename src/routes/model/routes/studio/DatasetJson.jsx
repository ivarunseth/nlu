import { useApi } from "../../../../contexts/ApiContext";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Spinner } from "react-bootstrap";
import { ArrowCounterclockwise, Floppy } from "react-bootstrap-icons";
import { useBlocker, useParams } from "react-router-dom";
import { ModelContext } from "../../../../contexts/ModelContext";
import { UserContext } from "../../../../contexts/UserContext";
import { useTrainings } from "../../../../contexts/TrainingContext";
import JsonEditor from "../../../../shared/components/JsonEditor";
import SaveDatasetModal from "./components/SaveDatasetModal";
import UnsavedChangesModal from "./components/UnsavedChangesModal";

// The Build page's JSON view: the whole authored dataset as one document
// (GET /dataset), edited in place and written back in one transaction (PUT
// /dataset). `original` is what the server last returned, `draft` is what the
// editor shows; Save diffs the two by id so the confirmation can say exactly
// what will be created, updated and deleted — deletes are by omission, so
// that summary is the guard against a slipped bracket. A failed save keeps
// the draft with the server's path-prefixed reason so the row can be fixed
// and resent.

// Every array under one of these keys holds rows with an `id`; anything else
// (`synonyms`) is a plain value list and diffs as part of its row. Spans are
// not rows: they travel inside an utterance's text as {name: value} markup.
const ROW_COLLECTIONS = ["labels", "intents", "entities", "slots", "values", "utterances"];

// Rows keyed by collection → id → signature of their own fields (nested rows
// excluded, parent included, so moving a row between parents counts as an
// update of that row alone), plus the number of id-less rows per collection.
const flatten = (document) => {
    const rows = {};
    const created = {};
    const walk = (node, collection, parentId) => {
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item, collection, parentId));
            return;
        }
        if (node === null || typeof node !== "object") return;
        if (collection === null) {
            Object.entries(node).forEach(([key, value]) => {
                if (ROW_COLLECTIONS.includes(key)) walk(value, key, null);
            });
            return;
        }
        const own = { _parent: parentId };
        Object.entries(node).forEach(([key, value]) => {
            if (ROW_COLLECTIONS.includes(key)) walk(value, key, node.id ?? "new");
            else own[key] = value;
        });
        if (node.id === null || node.id === undefined) {
            created[collection] = (created[collection] || 0) + 1;
        } else {
            (rows[collection] ||= new Map()).set(node.id, JSON.stringify(own));
        }
    };
    walk(document, null, null);
    return { rows, created };
};

export const diffDataset = (original, draft) => {
    // Fresh from the server the two are one object; nothing to walk.
    if (original === draft) return {};
    const before = flatten(original);
    const after = flatten(draft);
    const changes = {};
    ROW_COLLECTIONS.forEach((collection) => {
        const was = before.rows[collection] || new Map();
        const now = after.rows[collection] || new Map();
        let updated = 0;
        let deleted = 0;
        was.forEach((signature, id) => {
            if (!now.has(id)) deleted += 1;
            else if (now.get(id) !== signature) updated += 1;
        });
        const counts = { created: after.created[collection] || 0, updated, deleted };
        if (counts.created + counts.updated + counts.deleted > 0) changes[collection] = counts;
    });
    return changes;
};

// What `+ add …` inserts under each array. Key order is the display order;
// `id: null` marks the row as new to the reconciler. An utterance is just
// its text — spans are authored inline as {slot: value} / {entity: value},
// exactly as on the Build page.
const templatesFor = () => {
    const registry = { id: null, name: "", color: null, description: null };
    return {
        labels: { noun: "label", item: { ...registry, utterances: [] } },
        intents: { noun: "intent", item: { ...registry, slots: [], utterances: [] } },
        slots: { noun: "slot", item: { id: null, name: "", entity: null, color: null } },
        entities: { noun: "entity", item: { ...registry, list_type: "open", values: [] } },
        values: { noun: "value", item: { id: null, value: "", synonyms: [] } },
        synonyms: { noun: "synonym", item: "" },
        utterances: { noun: "utterance", item: { id: null, text: "" } }
    };
};

const NULLABLE = ["description", "color"];

// The last document loaded per model, kept for the session so coming back
// to the tab paints at once while a fresh copy is fetched behind it. The
// fresh copy replaces the cached one silently unless edits are already in
// progress on it — then the user is told and Discard loads the fresh one,
// since saving a draft built on a stale copy would drop rows added since.
const documentCache = new Map();
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

const DatasetJson = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const api = useApi();

    const [original, setOriginal] = useState(() => documentCache.get(modelId) ?? null);
    const [draft, setDraft] = useState(() => documentCache.get(modelId) ?? null);
    const [loading, setLoading] = useState(() => !documentCache.has(modelId));
    // A fresher document than the one being edited, held until Discard.
    const [pendingFresh, setPendingFresh] = useState(null);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [alert, setAlert] = useState(null);
    // The editor is a fixed pane that scrolls internally, sized to whatever
    // viewport is left below its top edge — measured, so it fits under both
    // the one-line and the wrapped context bar and under an open alert.
    const paneRef = useRef(null);
    const [paneHeight, setPaneHeight] = useState(null);
    // The footer grows a row per running training; its height is part of
    // what the pane has to leave room for.
    const stripRows = useTrainings().length;

    useEffect(() => {
        if (!user || !modelId) return;
        let cancelled = false;
        const cached = documentCache.get(modelId);
        const load = async () => {
            try {
                if (!cached) setLoading(true);
                const fresh = await api.dataset.get(modelId);
                if (cancelled) return;
                documentCache.set(modelId, fresh);
                if (!cached) {
                    setOriginal(fresh);
                    setDraft(fresh);
                } else if (!same(cached, fresh)) {
                    // Only swap under the editor when nothing has been touched.
                    setDraft((current) => {
                        if (same(current, cached)) {
                            setOriginal(fresh);
                            return fresh;
                        }
                        setPendingFresh(fresh);
                        setAlert({ variant: "warning", message: "The dataset changed since this copy was loaded. Discard your edits to load the latest before editing further." });
                        return current;
                    });
                }
            } catch (error) {
                if (!cancelled) setAlert({ variant: "danger", message: error?.response?.data?.error || "The dataset could not be loaded." });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId]);

    const handleDiscard = () => {
        if (pendingFresh) {
            setOriginal(pendingFresh);
            setDraft(pendingFresh);
            setPendingFresh(null);
            setAlert(null);
        } else {
            setDraft(original);
        }
    };

    const changes = useMemo(() => (original && draft ? diffDataset(original, draft) : {}), [original, draft]);
    const changeCount = Object.values(changes).reduce((sum, c) => sum + c.created + c.updated + c.deleted, 0);
    // Every editable field belongs to some row, so the id diff is the full
    // dirty check; an edit typed back to its original value counts as none.
    const dirty = changeCount > 0;

    // Leaving the page with unsaved edits loses them. In-app navigation
    // (another tab, the sub-nav, a breadcrumb, Back) is held by the router
    // until the user chooses; a tab close or reload can only get the
    // browser's own prompt.
    const blocker = useBlocker(({ currentLocation, nextLocation }) => (
        dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
    ));

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    useLayoutEffect(() => {
        const measure = () => {
            if (!paneRef.current) return;
            const top = paneRef.current.getBoundingClientRect().top + window.scrollY;
            // The footer (and the training rows it hosts) is off limits too.
            const docked = document.querySelector(".app-footer")?.offsetHeight || 0;
            setPaneHeight(Math.max(window.innerHeight - top - docked - 16, 240));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [loading, alert, stripRows]);

    const templates = useMemo(() => templatesFor(), []);
    const templateFor = useCallback((path) => templates[path[path.length - 1]], [templates]);
    const readOnly = useCallback((path) => path[path.length - 1] === "id", []);
    const nullable = useCallback((path) => NULLABLE.includes(path[path.length - 1]), []);
    // Records of the top-level collections open collapsed; one just added
    // (no id yet) opens expanded so its blank fields are right there.
    const startCollapsed = useCallback((path, value, depth) => depth === 2 && value?.id != null, []);

    // Returns whether the save landed, so a save-then-leave knows to go on.
    const handleSave = async () => {
        try {
            setSaving(true);
            const document = await api.dataset.save(modelId, draft);
            documentCache.set(modelId, document);
            setOriginal(document);
            setDraft(document);
            setPendingFresh(null);
            setConfirming(false);
            setAlert({ variant: "success", message: "Dataset saved." });
            return true;
        } catch (error) {
            setConfirming(false);
            setAlert({ variant: "danger", message: error?.response?.data?.error || "The dataset could not be saved." });
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAndLeave = async () => {
        if (await handleSave()) blocker.proceed();
        // On failure the alert explains and the page stays, edits intact.
        else blocker.reset();
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "40vh" }}>
                <Spinner animation="border" />
            </div>
        );
    }

    return (
        <>
            {alert && (
                <Alert className="mt-4" variant={alert.variant} onClose={() => setAlert(null)} dismissible>
                    {alert.message}
                </Alert>
            )}
            {draft && (
                <>
                    <div className="d-flex align-items-center gap-2 mt-4">
                        <small className="text-body-secondary flex-grow-1">
                            Click a value to edit it. <code>id</code> is read-only; rows removed here are deleted on save.
                            {model?.kind !== "text_classification" && (
                                <> Tag spans inline as <code>{"{"}{model?.kind === "natural_language_understanding" ? "slot" : "entity"}: value{"}"}</code>.</>
                            )}
                        </small>
                        {dirty && (
                            <Badge bg="warning-subtle" text="warning-emphasis" className="fw-medium">
                                {changeCount} change{changeCount === 1 ? "" : "s"}
                            </Badge>
                        )}
                        <Button
                            variant="light"
                            size="sm"
                            className="border d-inline-flex align-items-center"
                            disabled={(!dirty && !pendingFresh) || saving}
                            onClick={handleDiscard}
                        >
                            <ArrowCounterclockwise className="me-1" />
                            Discard
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            className="d-inline-flex align-items-center"
                            disabled={!dirty || saving}
                            onClick={() => setConfirming(true)}
                        >
                            <Floppy className="me-1" />
                            Save
                        </Button>
                    </div>
                    <div ref={paneRef} className="mt-3">
                        <JsonEditor
                            className="no-scrollbar"
                            style={paneHeight ? { height: paneHeight } : undefined}
                            value={draft}
                            onChange={setDraft}
                            readOnly={readOnly}
                            nullable={nullable}
                            templateFor={templateFor}
                            startCollapsed={startCollapsed}
                        />
                    </div>
                </>
            )}
            <UnsavedChangesModal
                show={blocker.state === "blocked"}
                changeCount={changeCount}
                saving={saving}
                onStay={() => blocker.reset()}
                onDiscard={() => blocker.proceed()}
                onSave={handleSaveAndLeave}
            />
            <SaveDatasetModal
                show={confirming}
                changes={changes}
                submitting={saving}
                onHide={() => setConfirming(false)}
                onSave={handleSave}
            />
        </>
    );
};

export default DatasetJson;
