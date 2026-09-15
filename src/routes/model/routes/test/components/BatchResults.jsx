import { useMemo, useState } from "react";
import { Badge, Button, ButtonGroup, Form, Spinner } from "react-bootstrap";
import {
    Braces,
    CheckCircle,
    Download,
    Files,
    SortDown,
    Stack,
    XCircle
} from "react-bootstrap-icons";
import Papa from "papaparse";
import { SectionLabel, EmptyState } from "../../../../../shared/components/SectionCard";
import downloadBlob from "../../../../../shared/utils/downloadBlob";
import { PredictionView, JsonView, isErrorPrediction, getLabels, getIntents } from "./Prediction";

// Compact per-row summary of a prediction, matching PredictionView's shape
// branching: top label + score (classification), intent badge (NLU), entity
// count (named entity recognition), a danger badge for error envelopes.
const RowSummary = ({ prediction }) => {
    if (prediction == null) {
        return <Spinner animation="border" size="sm" variant="secondary" />;
    }
    if (isErrorPrediction(prediction)) {
        return <Badge bg="danger">{prediction.type || "Error"}</Badge>;
    }
    const labels = getLabels(prediction);
    if (labels && labels.length > 0) {
        return (
            <span className="d-inline-flex align-items-center gap-2">
                <Badge bg="primary" className="fw-medium">{labels[0].name}</Badge>
                <span className="font-monospace text-muted small">
                    {((labels[0].score || 0) * 100).toFixed(1)}%
                </span>
            </span>
        );
    }
    const intents = getIntents(prediction);
    if (intents && intents.length > 0) {
        const slots = Array.isArray(prediction.entities) ? prediction.entities.length : 0;
        return (
            <span className="d-inline-flex align-items-center gap-2">
                <Badge bg="primary" className="fw-medium">{intents[0].name}</Badge>
                <span className="font-monospace text-muted small">
                    {((intents[0].score || 0) * 100).toFixed(1)}%
                </span>
                {slots > 0 && (
                    <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">
                        {slots} slot{slots === 1 ? "" : "s"}
                    </Badge>
                )}
            </span>
        );
    }
    if (typeof prediction === "object" && !Array.isArray(prediction) && "intent" in prediction) {
        return <Badge bg="primary" className="fw-medium">{prediction.intent}</Badge>;
    }
    if (typeof prediction === "object" && !Array.isArray(prediction) && Array.isArray(prediction.tags)) {
        const entities = Array.isArray(prediction.entities)
            ? prediction.entities.length
            : prediction.tags.filter((tag) => tag && tag !== "O").length;
        return (
            <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">
                {entities} entit{entities === 1 ? "y" : "ies"}
            </Badge>
        );
    }
    return <Badge bg="secondary-subtle" text="body-emphasis" className="border fw-normal">output</Badge>;
};

// Top-1 confidence of a classification- or intent-shaped prediction, else null.
const topScore = (prediction) => {
    const ranked = getLabels(prediction) || getIntents(prediction);
    return ranked && ranked.length > 0 && typeof ranked[0].score === "number"
        ? ranked[0].score
        : null;
};

// Flatten one result row for the CSV export: input, retained metadata
// columns, the predicted label/intent (+ score) or serialized output, and
// the error, if any.
const exportRow = (row, metaColumns) => {
    const prediction = row.prediction;
    const error = isErrorPrediction(prediction);
    const labels = getLabels(prediction);
    let label = "";
    let score = "";
    let output = "";
    if (!error && prediction != null) {
        const intents = getIntents(prediction);
        if (labels && labels.length > 0) {
            label = labels[0].name;
            score = labels[0].score;
        } else if (intents && intents.length > 0) {
            label = intents[0].name;
            score = intents[0].score;
        } else if (typeof prediction === "object" && !Array.isArray(prediction) && "intent" in prediction) {
            label = prediction.intent;
        }
        output = JSON.stringify(prediction);
    }
    return {
        input: row.input,
        ...Object.fromEntries(metaColumns.map((name) => [name, row.meta?.[name] ?? ""])),
        prediction: label,
        score,
        output,
        error_type: error ? prediction.type || "" : "",
        error: error ? prediction.error || "" : ""
    };
};

// The Batch tab of the response panel: a glanceable summary strip, a
// filterable/sortable list with one row per input, and an expandable detail
// per row that reuses the single-mode renderers.
const BatchResults = ({ results, running, progress, colorOf }) => {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [sortBy, setSortBy] = useState("order");
    const [selected, setSelected] = useState(null);
    const [detailView, setDetailView] = useState("result");

    const summary = useMemo(() => {
        if (!results) return null;
        const done = results.filter((row) => row.prediction != null);
        const failed = done.filter((row) => isErrorPrediction(row.prediction));
        const scores = done
            .map((row) => topScore(row.prediction))
            .filter((score) => score != null);
        return {
            total: results.length,
            succeeded: done.length - failed.length,
            failed: failed.length,
            mean: scores.length > 0
                ? scores.reduce((sum, score) => sum + score, 0) / scores.length
                : null
        };
    }, [results]);

    const visible = useMemo(() => {
        if (!results) return [];
        const needle = search.trim().toLowerCase();
        const rows = results
            .map((row, index) => ({ ...row, index }))
            .filter((row) => {
                if (needle && !row.input.toLowerCase().includes(needle)) return false;
                if (statusFilter === "ok") {
                    return row.prediction != null && !isErrorPrediction(row.prediction);
                }
                if (statusFilter === "error") {
                    return isErrorPrediction(row.prediction);
                }
                return true;
            });
        if (sortBy !== "order") {
            // Rows without a confidence (errors, NER/NLU) sink to the end.
            rows.sort((a, b) => {
                const scoreA = topScore(a.prediction);
                const scoreB = topScore(b.prediction);
                if (scoreA == null && scoreB == null) return a.index - b.index;
                if (scoreA == null) return 1;
                if (scoreB == null) return -1;
                return sortBy === "asc" ? scoreA - scoreB : scoreB - scoreA;
            });
        }
        return rows;
    }, [results, search, statusFilter, sortBy]);

    const handleExport = () => {
        const metaColumns = [...new Set(results.flatMap((row) => Object.keys(row.meta || {})))];
        const csv = Papa.unparse(results.map((row) => exportRow(row, metaColumns)));
        downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "batch-results.csv");
    };

    if (!results) {
        return (
            <EmptyState icon={<Files />} minHeight="100%">
                Switch to Batch mode in the request panel and upload a CSV to run one.
            </EmptyState>
        );
    }

    return (
        <div className="d-flex flex-column h-100" style={{ minHeight: 0 }}>
            <div className="d-flex align-items-center flex-wrap gap-3 mb-2 flex-shrink-0 small">
                <span className="d-inline-flex align-items-center gap-1 text-muted">
                    <Stack className="text-primary" />
                    <span className="font-monospace text-body-emphasis">{summary.total}</span> inputs
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-muted">
                    <CheckCircle className="text-success" />
                    <span className="font-monospace text-body-emphasis">{summary.succeeded}</span> ok
                </span>
                <span className="d-inline-flex align-items-center gap-1 text-muted">
                    <XCircle className={summary.failed > 0 ? "text-danger" : "text-muted"} />
                    <span className="font-monospace text-body-emphasis">{summary.failed}</span> failed
                </span>
                {summary.mean != null && (
                    <span className="d-inline-flex align-items-center gap-1 text-muted">
                        <SortDown className="text-primary" />
                        <span className="font-monospace text-body-emphasis">{(summary.mean * 100).toFixed(1)}%</span> mean top-1
                    </span>
                )}
                {running && progress && (
                    <span className="d-inline-flex align-items-center gap-2 text-muted ms-auto">
                        <Spinner animation="border" size="sm" />
                        {progress.done} / {progress.total}
                    </span>
                )}
                {!running && (
                    <Button
                        variant="light"
                        size="sm"
                        className="border d-inline-flex align-items-center gap-1 ms-auto"
                        onClick={handleExport}
                        title="Export inputs and predictions as CSV"
                    >
                        <Download />
                        Export
                    </Button>
                )}
            </div>

            <div className="d-flex align-items-center gap-2 mb-2 flex-shrink-0">
                <Form.Control
                    size="sm"
                    type="search"
                    placeholder="Filter inputs…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    style={{ maxWidth: "220px" }}
                />
                <ButtonGroup size="sm">
                    {[["all", "All"], ["ok", "OK"], ["error", "Errors"]].map(([value, label]) => (
                        <Button
                            key={value}
                            variant="light"
                            className="border"
                            active={statusFilter === value}
                            onClick={() => setStatusFilter(value)}
                        >
                            {label}
                        </Button>
                    ))}
                </ButtonGroup>
                <Form.Select
                    size="sm"
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    style={{ maxWidth: "190px" }}
                    className="ms-auto"
                    title="Sort results"
                >
                    <option value="order">Input order</option>
                    <option value="asc">Confidence · low first</option>
                    <option value="desc">Confidence · high first</option>
                </Form.Select>
            </div>

            <div className="flex-grow-1 overflow-auto border rounded" style={{ minHeight: 0 }}>
                {visible.length === 0 ? (
                    <div className="d-flex align-items-center justify-content-center h-100 text-muted small">
                        No results match the current filter.
                    </div>
                ) : (
                    <div className="list-group list-group-flush">
                        {visible.map((row) => {
                            const failed = isErrorPrediction(row.prediction);
                            const expanded = selected === row.index;
                            return (
                                <div key={row.index} className={failed ? "bg-danger-subtle bg-opacity-25" : ""}>
                                    <button
                                        type="button"
                                        className={`list-group-item list-group-item-action d-flex align-items-center gap-2 w-100 text-start ${failed ? "list-group-item-danger" : ""}`}
                                        onClick={() => {
                                            setSelected(expanded ? null : row.index);
                                            setDetailView("result");
                                        }}
                                        aria-expanded={expanded}
                                    >
                                        <span className="text-muted font-monospace flex-shrink-0" style={{ fontSize: "var(--app-text-xs)", minWidth: "32px" }}>
                                            {row.index + 1}
                                        </span>
                                        <span className="small text-truncate flex-grow-1" title={row.input}>
                                            {row.input}
                                        </span>
                                        <span className="flex-shrink-0">
                                            <RowSummary prediction={row.prediction} />
                                        </span>
                                    </button>
                                    {expanded && (
                                        <div className="p-3 border-top bg-body-tertiary">
                                            <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
                                                <div style={{ minWidth: 0 }}>
                                                    <SectionLabel>Input</SectionLabel>
                                                    <div className="small text-break">{row.input}</div>
                                                    {row.meta && Object.keys(row.meta).length > 0 && (
                                                        <div className="text-muted mt-1" style={{ fontSize: "var(--app-text-xs)" }}>
                                                            {Object.entries(row.meta).map(([name, value]) => (
                                                                <span key={name} className="me-3">
                                                                    <span className="fw-bold">{name}:</span> {String(value)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <ButtonGroup size="sm" className="flex-shrink-0">
                                                    <Button
                                                        variant="light"
                                                        className="border"
                                                        active={detailView === "result"}
                                                        onClick={() => setDetailView("result")}
                                                        title="Rendered result"
                                                    >
                                                        <SortDown />
                                                    </Button>
                                                    <Button
                                                        variant="light"
                                                        className="border"
                                                        active={detailView === "json"}
                                                        onClick={() => setDetailView("json")}
                                                        title="Raw JSON"
                                                    >
                                                        <Braces />
                                                    </Button>
                                                </ButtonGroup>
                                            </div>
                                            {detailView === "json" && row.prediction != null ? (
                                                <div style={{ maxHeight: "320px" }} className="overflow-auto">
                                                    <JsonView data={row.prediction} />
                                                </div>
                                            ) : (
                                                <PredictionView prediction={row.prediction} query={row.input} colorOf={colorOf} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BatchResults;
