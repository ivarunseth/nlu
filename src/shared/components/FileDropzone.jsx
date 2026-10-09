import { useRef, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { FileEarmarkArrowUp, FileEarmarkSpreadsheet, X } from "react-bootstrap-icons";

// Human-readable size for the selected-file chip. Binary units, one decimal
// only where it carries information — "4 KB" rather than "4.0 KB".
const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[unit]}`;
};

// The app's file input: a dashed drop target that also opens the file picker on
// click, Enter or Space. The native <input type="file"> is kept in the DOM but
// hidden — it is what actually opens the picker, and it keeps the field
// reachable by assistive tech and by form autofill.
//
// Controlled: the parent owns the File. `detail` overrides the size chip for
// callers that have something better to show (the batch panel shows its parsed
// row count).
const FileDropzone = ({
    file,
    onSelect,
    onClear,
    accept,
    disabled = false,
    busy = false,
    prompt = "Drag and drop a file here, or click to browse.",
    hint,
    detail,
    clearDisabled = false,
    minHeight = "120px",
    icon,
    id,
}) => {
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);

    const browse = () => {
        if (!disabled) inputRef.current?.click();
    };

    const clear = () => {
        // Reset the native input too: without this, re-picking the same file
        // fires no change event, so a removed file could not be re-added.
        if (inputRef.current) inputRef.current.value = "";
        (onClear || (() => onSelect(null)))();
    };

    return (
        <>
            <input
                ref={inputRef}
                id={id}
                type="file"
                accept={accept}
                className="d-none"
                disabled={disabled}
                onChange={(event) => onSelect(event.target.files?.[0] || null)}
            />

            {!file ? (
                <div
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled || undefined}
                    onClick={browse}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            browse();
                        }
                    }}
                    onDragOver={(event) => {
                        // Without preventDefault the browser navigates to the
                        // dropped file instead of handing it over.
                        event.preventDefault();
                        if (!disabled) setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragOver(false);
                        if (!disabled) onSelect(event.dataTransfer.files?.[0] || null);
                    }}
                    className={`d-flex flex-column align-items-center justify-content-center text-center p-4 rounded ${dragOver ? "bg-body-tertiary" : ""} ${disabled ? "opacity-50" : ""}`}
                    style={{
                        border: `2px dashed ${dragOver ? "var(--bs-primary)" : "var(--bs-border-color)"}`,
                        cursor: disabled ? "not-allowed" : "pointer",
                        minHeight
                    }}
                >
                    {busy ? (
                        <Spinner animation="border" size="sm" variant="secondary" />
                    ) : (
                        <>
                            {icon || <FileEarmarkArrowUp className="fs-3 mb-2 text-muted" />}
                            <span className="small fw-bold text-body-emphasis">{prompt}</span>
                            {hint && (
                                <span className="text-muted mt-1" style={{ fontSize: "var(--app-text-xs)" }}>
                                    {hint}
                                </span>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <div className="d-flex align-items-center gap-2 border rounded p-2 bg-body">
                    <FileEarmarkSpreadsheet className="text-primary flex-shrink-0" />
                    <span className="small fw-medium text-truncate flex-grow-1" title={file.name}>
                        {file.name}
                    </span>
                    {detail ?? (
                        <span className="text-muted flex-shrink-0" style={{ fontSize: "var(--app-text-xs)" }}>
                            {formatSize(file.size)}
                        </span>
                    )}
                    <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-muted flex-shrink-0"
                        onClick={clear}
                        disabled={clearDisabled}
                        title="Remove file"
                        aria-label="Remove file"
                    >
                        <X className="fs-5" />
                    </Button>
                </div>
            )}
        </>
    );
};

export default FileDropzone;
