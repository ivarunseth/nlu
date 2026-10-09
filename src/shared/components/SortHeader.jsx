import { CaretDownFill, CaretUpFill } from "react-bootstrap-icons";

// A sortable table header cell. Clicking it asks the parent to sort by
// `field`; the active column shows a caret for its direction while the
// others show a faint idle caret so the whole row reads as sortable. Sorting
// happens server-side (see useTableControls), so this only reflects and
// requests state — it never reorders rows itself.
const SortHeader = ({ field, icon, children, sort, order, onSort, className = "" }) => {
    const active = sort === field;
    return (
        <th className={className} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
            <span
                role="button"
                tabIndex={0}
                className="d-inline-flex align-items-center gap-1"
                onClick={() => onSort(field)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSort(field);
                    }
                }}
                title={`Sort by ${typeof children === "string" ? children.toLowerCase() : field}`}
            >
                {icon && <span className="text-muted">{icon}</span>}
                {children}
                {active ? (
                    order === "asc" ? <CaretUpFill className="text-primary" /> : <CaretDownFill className="text-primary" />
                ) : (
                    <CaretDownFill className="text-muted opacity-25" />
                )}
            </span>
        </th>
    );
};

export default SortHeader;
