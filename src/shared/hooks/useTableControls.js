import { useMemo, useState } from "react";

// Shared sort + filter state for the server-paginated collection tables
// (models, labels/intents, trainings, entities). The backend does the actual
// sorting and filtering across the whole dataset, so this hook only tracks
// the chosen controls and flattens them into the query params those
// endpoints understand (`sort`, `order`, one key per filter, and the
// `created_from`/`created_to` date window).
//
// `filters` is declarative so a single <TableToolbar> can render the dropdowns
// and the hook can label the active-filter chips without the page repeating
// itself: each entry is { name, label, options: [{ value, label }], icon? }.
const useTableControls = ({ defaultSort, filters = [], onChange } = {}) => {
    const [sort, setSort] = useState(defaultSort?.field ?? null);
    const [order, setOrder] = useState(defaultSort?.order ?? "desc");
    // { [filterName]: string[] } — multi-select, empty array means "any".
    const [selected, setSelected] = useState({});
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    // Let callers reset pagination whenever the effective query changes.
    const notify = () => onChange?.();

    // Clicking a column header cycles it to ascending, then toggles; picking a
    // new column starts descending, the sensible default for dates/metrics.
    const toggleSort = (field) => {
        if (sort === field) {
            setOrder((previous) => (previous === "asc" ? "desc" : "asc"));
        } else {
            setSort(field);
            setOrder("desc");
        }
        notify();
    };

    const setFilter = (name, values) => {
        setSelected((previous) => ({ ...previous, [name]: values }));
        notify();
    };

    const setDateRange = (from, to) => {
        setDateFrom(from);
        setDateTo(to);
        notify();
    };

    const clearAll = () => {
        setSelected({});
        setDateFrom("");
        setDateTo("");
        notify();
    };

    // Flattened query params to spread into the axios request.
    const params = useMemo(() => {
        const next = {};
        if (sort) {
            next.sort = sort;
            next.order = order;
        }
        filters.forEach(({ name }) => {
            const values = selected[name];
            // Comma-joined so axios sends one `name=a,b` param; the backend
            // (utils.query.list_argument) splits it back into a list. Sending
            // a raw array would serialize as `name[]=a&name[]=b`, which the
            // server's getlist(name) never sees.
            if (values && values.length) next[name] = values.join(",");
        });
        if (dateFrom) next.created_from = dateFrom;
        if (dateTo) next.created_to = dateTo;
        return next;
    }, [sort, order, selected, dateFrom, dateTo, filters]);

    // Dismissible summary of everything currently narrowing the table.
    const chips = useMemo(() => {
        const list = [];
        filters.forEach((filter) => {
            (selected[filter.name] || []).forEach((value) => {
                const option = filter.options.find((item) => item.value === value);
                list.push({
                    key: `${filter.name}:${value}`,
                    label: `${filter.label}: ${option ? option.label : value}`,
                    onRemove: () => setFilter(
                        filter.name,
                        (selected[filter.name] || []).filter((item) => item !== value)
                    )
                });
            });
        });
        if (dateFrom) {
            list.push({ key: "from", label: `From ${dateFrom}`, onRemove: () => setDateRange("", dateTo) });
        }
        if (dateTo) {
            list.push({ key: "to", label: `To ${dateTo}`, onRemove: () => setDateRange(dateFrom, "") });
        }
        return list;
    }, [filters, selected, dateFrom, dateTo]);

    return {
        sort,
        order,
        selected,
        dateFrom,
        dateTo,
        filters,
        params,
        chips,
        toggleSort,
        setFilter,
        setDateRange,
        clearAll
    };
};

export default useTableControls;
