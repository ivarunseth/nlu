import { useApi } from "../../../../contexts/ApiContext";
import { useContext, useEffect, useState } from "react";
import { Button, Dropdown, Nav } from "react-bootstrap";
import { Bookmarks, BracesAsterisk, PencilSquare, Diagram2, Download, Quote, Tags, Upload } from "react-bootstrap-icons";
import { useParams, useSearchParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import MetricsStrip from "../../../../shared/components/MetricsStrip";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import ClassificationBuild from "./ClassificationBuild";
import EntitiesBuild from "./components/EntitiesBuild";
import EntityValues from "./components/EntityValues";
import EntitySlots from "./components/EntitySlots";
import ImportDatasetModal, { NLU_DATASET_FORMATS } from "./components/ImportDatasetModal";
import IntentWorkspace from "./components/IntentWorkspace";

// Build page for language understanding models: the Intents / Entities IA.
//
// - Intents lists the intent registry; drilling into an intent opens its
//   workspace — its utterances, its slots panel (each slot naming a role
//   and mapping to an entity) and span annotation over those utterances
//   using this intent's slots.
// - Entities lists the global entity registry (the reusable types slots
//   map to); drilling into an entity catalogues every distinct dataset
//   value that filled it, across all intents and slots.
//
// The active tab and drill-ins live in search params (?tab=, ?intent=,
// ?entity=) so both levels deep-link and the browser's back button walks
// out of a drill-in naturally.
//
// The tab pills stay visible on a drill-in too, so switching between Intents
// and Entities doesn't require backing out via the breadcrumb first; the
// Import/Export actions and the overview metrics strip remain overview-only.
const UnderstandingBuild = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get("tab") === "entities" ? "entities" : "intents";
    const intentId = searchParams.get("intent");
    const entityId = searchParams.get("entity");
    const drilledIn = tab === "intents" ? intentId != null : entityId != null;

    const [showImport, setShowImport] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importSummary, setImportSummary] = useState(null);
    const [exporting, setExporting] = useState(false);
    // Remounts the tab content after an import pulls in new registries.
    const [imported, setImported] = useState(0);
    // Model-wide dataset-health counts for the overview strips; bumped by the
    // tables whenever a create/delete changes the totals.
    const [stats, setStats] = useState({ intents: 0, entities: 0, slots: 0, utterances: 0, annotated: 0, spans: 0, values: 0 });
    const [statsRefresh, setStatsRefresh] = useState(0);

    const api = useApi();

    useEffect(() => {
        if (user && modelId && !drilledIn) {
            const getStats = async () => {
                try {
                    setStats(await api.tags.stats(modelId));
                } catch (error) {
                    // The strip is an overview nicety; the tables surface errors.
                    console.error(error);
                }
            };
            getStats();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, drilledIn, imported, statsRefresh]);

    const handleImport = async (file, format) => {
        const data = new FormData();
        data.append("format", format);
        data.append("dataset", file);
        try {
            setImporting(true);
            setImportSummary(await api.tags.importDataset(modelId, data));
            setImported((n) => n + 1);
        } catch (error) {
            setImportSummary({ imported: 0, created: [], errors: [{ line: 0, error: error?.response?.data?.error || "Import failed." }] });
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
            const blob = await api.tags.exportDataset(modelId, format);
            const extension = { json: "jsonl", csv: "csv" }[format] || "txt";
            downloadBlob(blob, `${modelId}-${format}.${extension}`);
        } catch (error) {
            // The export endpoint only fails on auth/404; nothing to surface inline.
            console.error(error);
        } finally {
            setExporting(false);
        }
    };

    const annotatedRate = `${stats.utterances > 0 ? Math.round((stats.annotated / stats.utterances) * 100) : 0}%`;

    return (
        <>
            <div className="d-flex align-items-center mt-4">
                <Nav
                    variant="pills"
                    className="small flex-grow-1"
                    activeKey={tab}
                    onSelect={(key) => setSearchParams(key === "entities" ? { tab: "entities" } : { tab: "intents" })}
                >
                    <Nav.Item>
                        <Nav.Link eventKey="intents" className="d-inline-flex align-items-center gap-1">
                            <Bookmarks />
                            Intents
                        </Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="entities" className="d-inline-flex align-items-center gap-1">
                            <Tags />
                            Entities
                        </Nav.Link>
                    </Nav.Item>
                </Nav>
                {!drilledIn && (
                    <div className="d-flex gap-2">
                        <Button
                            variant="light"
                            size="sm"
                            className="border d-inline-flex align-items-center"
                            onClick={() => setShowImport(true)}
                            title="Import a pre-annotated dataset (intents, slots and entities are auto-created)"
                        >
                            <Upload className="me-1" />
                            <span className="d-none d-sm-inline">Import</span>
                        </Button>
                        <Dropdown>
                            <Dropdown.Toggle
                                variant="light"
                                size="sm"
                                className="border d-inline-flex align-items-center"
                                disabled={exporting}
                                title="Export the dataset with its intents, slots and slot→entity mapping"
                            >
                                <Download className="me-1" />
                                <span className="d-none d-sm-inline">Export</span>
                            </Dropdown.Toggle>
                            <Dropdown.Menu align="end">
                                {NLU_DATASET_FORMATS.map((item) => (
                                    <Dropdown.Item key={item.value} onClick={() => handleExport(item.value)}>
                                        {item.label}
                                    </Dropdown.Item>
                                ))}
                            </Dropdown.Menu>
                        </Dropdown>
                    </div>
                )}
            </div>
            {!drilledIn && (
                <MetricsStrip
                    className="mt-4"
                    items={tab === "intents" ? [
                        { label: "Intents", value: stats.intents, icon: <Bookmarks /> },
                        { label: "Utterances", value: stats.utterances, icon: <Quote /> },
                        {
                            label: "Annotated",
                            value: annotatedRate,
                            sub: `${stats.annotated} / ${stats.utterances}`,
                            icon: <PencilSquare />
                        },
                        { label: "Slot spans", value: stats.spans, icon: <BracesAsterisk /> }
                    ] : [
                        { label: "Entities", value: stats.entities, icon: <Tags /> },
                        { label: "Values", value: stats.values ?? 0, icon: <Quote /> },
                        { label: "Slots", value: stats.slots, icon: <Diagram2 /> },
                        { label: "Slot spans", value: stats.spans, icon: <BracesAsterisk /> }
                    ]}
                />
            )}
            {tab === "intents" ? (
                intentId ? (
                    <IntentWorkspace
                        key={`${intentId}-${imported}`}
                        intentId={intentId}
                    />
                ) : (
                    <ClassificationBuild
                        key={`intents-${imported}`}
                        noun="intent"
                        labelLink={(label) => `/models/${modelId}/build?tab=intents&intent=${label.id}`}
                        onMutate={() => setStatsRefresh((n) => n + 1)}
                    />
                )
            ) : entityId ? (
                <>
                    <EntityValues
                        key={`${entityId}-${imported}`}
                        entityId={entityId}
                    />
                    <EntitySlots
                        key={`slots-${entityId}-${imported}`}
                        entityId={entityId}
                    />
                </>
            ) : (
                <EntitiesBuild
                    key={`entities-${imported}`}
                    entityLink={(entity) => `/models/${modelId}/build?tab=entities&entity=${entity.id}`}
                    onMutate={() => setStatsRefresh((n) => n + 1)}
                />
            )}
            <ImportDatasetModal
                show={showImport}
                submitting={importing}
                summary={importSummary}
                formats={NLU_DATASET_FORMATS}
                onHide={closeImport}
                onSubmit={handleImport}
            />
        </>
    );
};

export default UnderstandingBuild;
