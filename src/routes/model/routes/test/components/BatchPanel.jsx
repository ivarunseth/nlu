import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, Spinner } from "react-bootstrap";
import { ExclamationTriangle, Play, Upload } from "react-bootstrap-icons";
import Papa from "papaparse";
import { SectionLabel } from "../../../../../shared/components/SectionCard";
import FileDropzone from "../../../../../shared/components/FileDropzone";

// Names that mark a column as the model input when auto-picking.
const INPUT_COLUMN_NAMES = /^(text|query|input|utterance|sentence|review)$/i;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const PREVIEW_ROWS = 5;

// Batch input surface of the Test page's request panel: a drag-and-drop
// CSV/TSV dropzone, client-side parsing (papaparse handles quoted fields
// and delimiter detection), input-column pick and a row preview. Rows are
// handed up as { input, meta } and submitted by the page in one batch.
const BatchPanel = ({
    isDeployed,
    busy,
    running,
    progress,
    top,
    labelCount,
    onTopChange,
    onRun
}) => {
    const [file, setFile] = useState(null);
    const [rawRows, setRawRows] = useState([]);
    const [hasHeader, setHasHeader] = useState(true);
    const [columnIndex, setColumnIndex] = useState(0);
    const [parseError, setParseError] = useState(null);
    const [parsing, setParsing] = useState(false);

    const disabled = busy || running || !isDeployed;

    const handleFile = (selected) => {
        setParseError(null);
        if (!selected) return;
        if (!/\.(csv|tsv)$/i.test(selected.name)) {
            setParseError("Only .csv and .tsv files are supported.");
            return;
        }
        if (selected.size > MAX_FILE_BYTES) {
            setParseError("The file is larger than 10 MB. Split it up and upload a part.");
            return;
        }
        setParsing(true);
        Papa.parse(selected, {
            skipEmptyLines: "greedy",
            complete: (result) => {
                const rows = (result.data || []).filter((row) => Array.isArray(row) && row.length > 0);
                if (rows.length === 0) {
                    setParseError("No rows could be parsed from the file.");
                } else {
                    setFile(selected);
                    setRawRows(rows);
                }
                setParsing(false);
            },
            error: (error) => {
                setParseError(error.message || "The file could not be parsed.");
                setParsing(false);
            }
        });
    };

    const handleClear = () => {
        setFile(null);
        setRawRows([]);
        setParseError(null);
    };

    const columns = useMemo(() => {
        if (rawRows.length === 0) return [];
        const width = Math.max(...rawRows.map((row) => row.length));
        return Array.from({ length: width }, (_, index) => {
            const name = hasHeader ? String(rawRows[0][index] ?? "").trim() : "";
            return name || `Column ${index + 1}`;
        });
    }, [rawRows, hasHeader]);

    const dataRows = useMemo(
        () => (hasHeader ? rawRows.slice(1) : rawRows),
        [rawRows, hasHeader]
    );

    // Re-pick the input column whenever the file or the header toggle
    // changes: a text/query/input-named column if present, else the first.
    useEffect(() => {
        if (columns.length === 0) return;
        const preferred = columns.findIndex((name) => INPUT_COLUMN_NAMES.test(name));
        setColumnIndex(preferred >= 0 ? preferred : 0);
    }, [columns]);

    // Rows the batch will run: the chosen column as the input, the other
    // columns retained as per-row metadata for display and export. Rows
    // with a blank input cell are skipped and counted.
    const { rows, skipped } = useMemo(() => {
        const parsed = [];
        let blank = 0;
        dataRows.forEach((row) => {
            const input = String(row[columnIndex] ?? "").trim();
            if (!input) {
                blank += 1;
                return;
            }
            const meta = {};
            columns.forEach((name, index) => {
                if (index !== columnIndex) meta[name] = row[index] ?? "";
            });
            parsed.push({ input, meta });
        });
        return { rows: parsed, skipped: blank };
    }, [dataRows, columns, columnIndex]);

    return (
        <div className="d-flex flex-column flex-grow-1">
            <Form.Label className="mb-1"><SectionLabel>Input file</SectionLabel></Form.Label>
            <FileDropzone
                file={file}
                onSelect={handleFile}
                onClear={handleClear}
                accept=".csv,.tsv"
                disabled={disabled}
                busy={parsing}
                clearDisabled={running}
                minHeight="140px"
                icon={<Upload className="fs-3 mb-2 text-muted" />}
                prompt={isDeployed
                    ? "Drag and drop a .csv or .tsv file here, or click to browse."
                    : "Deploy a version first to start batch testing."}
                hint="One prediction per row · up to 10 MB"
                detail={(
                    <Badge bg="secondary-subtle" text="body-emphasis" className="border font-monospace fw-normal flex-shrink-0">
                        {rows.length} input{rows.length === 1 ? "" : "s"}
                    </Badge>
                )}
            />
            {file && (
                <>
                    <div className="mb-2" />
                    <Form.Group className="mb-2">
                        <Form.Check
                            type="checkbox"
                            id="batch-contains-header"
                            className="small"
                            label="contains header"
                            checked={hasHeader}
                            onChange={(event) => setHasHeader(event.target.checked)}
                            disabled={running}
                        />
                        <Form.Text className="text-muted d-block" style={{ fontSize: "var(--app-text-xs)" }}>
                            Check only if the file contains a header with column names.
                        </Form.Text>
                    </Form.Group>

                    {columns.length > 1 && (
                        <Form.Group className="mb-2">
                            <Form.Label className="mb-1"><SectionLabel>Input column</SectionLabel></Form.Label>
                            <Form.Select
                                size="sm"
                                value={columnIndex}
                                onChange={(event) => setColumnIndex(Number(event.target.value))}
                                disabled={running}
                            >
                                {columns.map((name, index) => (
                                    <option key={index} value={index}>{name}</option>
                                ))}
                            </Form.Select>
                            <Form.Text className="text-muted d-block" style={{ fontSize: "var(--app-text-xs)" }}>
                                The remaining columns are kept alongside each result and included in the export.
                            </Form.Text>
                        </Form.Group>
                    )}

                    <div className="mb-3">
                        <SectionLabel>Preview</SectionLabel>
                        <div className="border rounded mt-1 overflow-hidden">
                            {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                                <div
                                    key={index}
                                    className={`px-2 py-1 small text-truncate ${index > 0 ? "border-top" : ""}`}
                                    title={row.input}
                                >
                                    <span className="text-muted font-monospace me-2" style={{ fontSize: "var(--app-text-xs)" }}>{index + 1}</span>
                                    {row.input}
                                </div>
                            ))}
                            {rows.length === 0 && (
                                <div className="px-2 py-1 small text-muted">No usable inputs in this column.</div>
                            )}
                        </div>
                        <div className="text-muted mt-1" style={{ fontSize: "var(--app-text-xs)" }}>
                            {rows.length > PREVIEW_ROWS && `Showing ${PREVIEW_ROWS} of ${rows.length} inputs. `}
                            {skipped > 0 && `${skipped} row${skipped === 1 ? "" : "s"} with a blank input skipped.`}
                        </div>
                    </div>
                </>
            )}

            {parseError && (
                <Alert variant="danger" className="d-flex align-items-start gap-2 small py-2">
                    <ExclamationTriangle className="mt-1 flex-shrink-0" />
                    <span>{parseError}</span>
                </Alert>
            )}

            {labelCount > 1 && (
                <div className="mb-3">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                        <SectionLabel>Top labels</SectionLabel>
                        <span className="font-monospace small text-body-emphasis">{top} / {labelCount}</span>
                    </div>
                    <Form.Range
                        min={1}
                        max={labelCount}
                        value={top}
                        onChange={(event) => onTopChange(Number(event.target.value))}
                        disabled={disabled}
                    />
                </div>
            )}

            <div className="d-flex align-items-center justify-content-between mt-auto">
                <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                    {running && progress
                        ? `Running ${progress.done} / ${progress.total}…`
                        : "Inputs are submitted in batches and every row gets a result."}
                </span>
                <Button
                    variant="light"
                    size="sm"
                    className="border d-inline-flex align-items-center gap-1 px-3"
                    onClick={() => onRun(rows)}
                    disabled={disabled || rows.length === 0}
                >
                    {running ? (
                        <><Spinner animation="border" size="sm" />&nbsp;Running</>
                    ) : (
                        <><Play />&nbsp;Run batch{rows.length > 0 ? ` (${rows.length})` : ""}</>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default BatchPanel;
