import { Badge, Button, Dropdown, Form } from "react-bootstrap";
import { Calendar3, Funnel, X } from "react-bootstrap-icons";

// The filter surface shared by the collection tables, driven by a
// useTableControls instance. Renders one checkbox dropdown per declared
// filter plus an optional created-date window; all of it is compact enough
// to sit on the toolbar row next to the search box.
//
// Pass `dateRange` to enable the date dropdown. Filtering is server-side, so
// changing anything here just updates the params the page already refetches
// with.
const FilterDropdown = ({ filter, values, onChange }) => {
    const count = values.length;
    const toggle = (value) => {
        onChange(
            count && values.includes(value)
                ? values.filter((item) => item !== value)
                : [...values, value]
        );
    };
    return (
        <Dropdown autoClose="outside">
            <Dropdown.Toggle
                variant="light"
                size="sm"
                className="border d-inline-flex align-items-center gap-1"
            >
                {filter.icon || <Funnel className="text-muted" />}
                {filter.label}
                {count > 0 && <Badge bg="primary" pill>{count}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu className="p-2" style={{ minWidth: "200px" }}>
                {filter.options.map((option) => (
                    <Form.Check
                        key={option.value}
                        type="checkbox"
                        id={`filter-${filter.name}-${option.value}`}
                        className="small py-1"
                        label={option.label}
                        checked={values.includes(option.value)}
                        onChange={() => toggle(option.value)}
                    />
                ))}
            </Dropdown.Menu>
        </Dropdown>
    );
};

const DateDropdown = ({ from, to, onChange }) => {
    const active = Boolean(from || to);
    return (
        <Dropdown autoClose="outside">
            <Dropdown.Toggle
                variant="light"
                size="sm"
                className="border d-inline-flex align-items-center gap-1"
            >
                <Calendar3 className="text-muted" />
                Date
                {active && <Badge bg="primary" pill>1</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu className="p-3" style={{ minWidth: "240px" }}>
                <Form.Group className="mb-2">
                    <Form.Label className="small fw-bold mb-1">From</Form.Label>
                    <Form.Control
                        type="date"
                        size="sm"
                        value={from}
                        max={to || undefined}
                        onChange={(event) => onChange(event.target.value, to)}
                    />
                </Form.Group>
                <Form.Group className="mb-2">
                    <Form.Label className="small fw-bold mb-1">To</Form.Label>
                    <Form.Control
                        type="date"
                        size="sm"
                        value={to}
                        min={from || undefined}
                        onChange={(event) => onChange(from, event.target.value)}
                    />
                </Form.Group>
                {active && (
                    <Button variant="link" size="sm" className="p-0 text-muted small" onClick={() => onChange("", "")}>
                        Clear dates
                    </Button>
                )}
            </Dropdown.Menu>
        </Dropdown>
    );
};

export const TableFilters = ({ controls, dateRange = false, className = "" }) => (
    <div className={`d-flex flex-wrap align-items-center gap-2 ${className}`}>
        {controls.filters.map((filter) => (
            <FilterDropdown
                key={filter.name}
                filter={filter}
                values={controls.selected[filter.name] || []}
                onChange={(values) => controls.setFilter(filter.name, values)}
            />
        ))}
        {dateRange && (
            <DateDropdown
                from={controls.dateFrom}
                to={controls.dateTo}
                onChange={(from, to) => controls.setDateRange(from, to)}
            />
        )}
    </div>
);

// The dismissible summary of active filters. Renders nothing when the table
// is unfiltered, so it costs no vertical space in the common case.
export const FilterChips = ({ controls, className = "" }) => {
    if (controls.chips.length === 0) return null;
    return (
        <div className={`d-flex flex-wrap align-items-center gap-2 ${className}`}>
            {controls.chips.map((chip) => (
                <Badge
                    key={chip.key}
                    bg="light"
                    text="dark"
                    className="border fw-normal d-inline-flex align-items-center gap-1"
                    style={{ cursor: "pointer" }}
                    role="button"
                    onClick={chip.onRemove}
                    title="Remove filter"
                >
                    {chip.label}
                    <X />
                </Badge>
            ))}
            <Button variant="link" size="sm" className="p-0 text-muted small text-decoration-none" onClick={controls.clearAll}>
                Clear all
            </Button>
        </div>
    );
};

export default TableFilters;
