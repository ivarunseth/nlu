import axios from "axios";
import { useContext, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import { BookmarkStar, Diagram2, InfoCircle, Option, Pen, PlusLg, Search, Tag, Tags, Trash } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { UserContext } from "../../../../../contexts/UserContext";
import AppPagination from "../../../../../shared/components/AppPagination";
import DeleteConfirmationModal from "../../../../../shared/components/DeleteConfirmationModal";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";
import SortHeader from "../../../../../shared/components/SortHeader";
import { TableFilters, FilterChips } from "../../../../../shared/components/TableFilters";
import { COLORS, nextEntityColor } from "../../../../../shared/components/entityColors";
import useDebounce from "../../../../../shared/hooks/useDebounce";
import useTableControls from "../../../../../shared/hooks/useTableControls";
import { EntityDot } from "./EntitiesPanel";
import EntityFormModal from "./EntityFormModal";

const PER_PAGE = 7;
const MAX_VISIBLE_PAGES = 5;

// Entities carry an open/closed value-space type, offered here as a filter.
const ENTITY_FILTERS = [
    {
        name: "kind",
        label: "List type",
        options: [
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" }
        ]
    }
];

// The Entities tab of a language understanding model (EN-1): the global
// registry of reusable span types. Each row reports how many slots
// reference the entity (across all intents) and how many distinct surface
// values fill it in the dataset; the name drills into the value catalogue.
// `onMutate` tells the parent a create/edit/delete changed the totals its
// overview strip reports.
const EntitiesBuild = ({ entityLink, onMutate }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const [alert, setAlert] = useState(null);

    const [entities, setEntities] = useState([]);
    const [loading, setLoading] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const [showForm, setShowForm] = useState(false);
    const [current, setCurrent] = useState(null);
    const [name, setName] = useState("");
    const [color, setColor] = useState(COLORS[0]);
    const [description, setDescription] = useState("");
    const [listType, setListType] = useState("open");
    const [toDelete, setToDelete] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const controls = useTableControls({
        defaultSort: { field: "name", order: "asc" },
        filters: ENTITY_FILTERS,
        onChange: () => setPage(1)
    });

    const debouncedQuery = useDebounce(query, 500);
    const controlsKey = JSON.stringify(controls.params);
    const headers = { Authorization: `Bearer ${user?.token}` };

    const showError = (error, fallback = "Something went wrong.") => {
        setAlert({ variant: "danger", message: error?.response?.data?.error || fallback });
    };

    const closeForm = () => {
        setShowForm(false);
        setCurrent(null);
        setValidated(false);
        setSubmitting(false);
    };

    const handleOpenCreate = () => {
        setCurrent(null);
        setName("");
        setColor(nextEntityColor(entities.map((entity) => entity.color)));
        setDescription("");
        setListType("open");
        setValidated(false);
        setShowForm(true);
    };

    const handleOpenEdit = (entity) => {
        setCurrent(entity);
        setName(entity.name);
        setColor(entity.color || COLORS[0]);
        setDescription(entity.description || "");
        setListType(entity.list_type || "open");
        setValidated(false);
        setShowForm(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) {
            e.stopPropagation();
            setValidated(true);
            return;
        }
        setValidated(true);

        const data = new FormData();
        data.append("name", name.trim());
        data.append("color", color);
        data.append("description", description);
        data.append("list_type", listType);

        try {
            setSubmitting(true);
            if (current) {
                await axios.put(`/api/models/${modelId}/entities/${current.id}`, data, { headers });
                setRefresh((n) => n + 1);
            } else {
                await axios.post(`/api/models/${modelId}/entities`, data, { headers });
                // Jump to the first page to reveal the newly created entity.
                if (page !== 1) setPage(1); else setRefresh((n) => n + 1);
            }
            onMutate?.();
        } catch (error) {
            showError(error);
        } finally {
            closeForm();
        }
    };

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            await axios.delete(`/api/models/${modelId}/entities/${toDelete.id}`, { headers });
            // Removing the last row on a trailing page steps back a page.
            if (entities.length === 1 && page > 1) setPage(page - 1);
            else setRefresh((n) => n + 1);
            onMutate?.();
        } catch (error) {
            showError(error);
        } finally {
            setToDelete(null);
            setSubmitting(false);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {
        if (user && modelId) {
            const getEntities = async () => {
                try {
                    setLoading(true);
                    const params = { page, per_page: PER_PAGE, ...controls.params };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${modelId}/entities`, { params, headers });
                    setEntities(response.data.entities);
                    setTotal(response.data.total);
                } catch (error) {
                    showError(error);
                } finally {
                    setLoading(false);
                }
            };
            getEntities();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, modelId, page, debouncedQuery, refresh, controlsKey]);

    return (
        <>
            {alert && (
                <Alert className="mt-4" variant={alert.variant} onClose={() => setAlert(null)} dismissible>
                    {alert.message}
                </Alert>
            )}
            <Row className="mt-4 g-2">
                <Col xs="auto">
                    <Button variant="light" className="border" onClick={handleOpenCreate}>
                        <PlusLg />&nbsp;create entity
                    </Button>
                </Col>
                <Col xs="auto">
                    <TableFilters controls={controls} dateRange />
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for entities..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <FilterChips controls={controls} className="mt-3" />
            <Card className="border-light overflow-hidden mt-4">
                <CardHeading
                    icon={<Tags />}
                    title="Entities"
                    right={
                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                            {total} entit{total === 1 ? "y" : "ies"}
                        </span>
                    }
                />
                <Card.Body className="p-0">
                    <Table responsive hover className="mb-0 align-middle text-center" style={{ minHeight: "33vh" }}>
                        <thead>
                            <tr>
                                <SortHeader field="name" icon={<Tag />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort} className="text-start ps-3">Name</SortHeader>
                                <th className="text-start">Description</th>
                                <th><Diagram2 className="text-muted" />&nbsp;Slots</th>
                                <th><BookmarkStar className="text-muted" />&nbsp;Spans</th>
                                <SortHeader field="values_count" sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Values</SortHeader>
                                <th><Option className="text-muted" />&nbsp;Options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                                        <Spinner animation="border" size="lg" />
                                    </td>
                                </tr>
                            ) : entities.length > 0 ? entities.map((entity) => (
                                <tr key={entity.id}>
                                    <td className="text-start ps-3">
                                        <Link to={entityLink(entity)} className="text-decoration-none d-inline-flex align-items-center gap-2">
                                            <EntityDot color={entity.color} />
                                            {entity.name}
                                        </Link>
                                        <Badge bg="light" text="dark" className="border fw-normal ms-2">
                                            {entity.list_type === "closed" ? "closed" : "open"}
                                        </Badge>
                                    </td>
                                    <td className="text-start small text-muted text-truncate" style={{ maxWidth: "240px" }}>
                                        {entity.description || "—"}
                                    </td>
                                    <td>
                                        <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                            {entity.slots_count ?? 0}
                                        </Badge>
                                    </td>
                                    <td>
                                        <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                            {entity.annotations_count ?? 0}
                                        </Badge>
                                    </td>
                                    <td>
                                        <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                            {entity.values_count ?? 0}
                                        </Badge>
                                    </td>
                                    <td>
                                        <Button
                                            variant="light"
                                            size="sm"
                                            className="border me-1"
                                            title={`Edit ${entity.name}`}
                                            aria-label={`Edit ${entity.name}`}
                                            onClick={() => handleOpenEdit(entity)}
                                        >
                                            <Pen />
                                        </Button>
                                        <Button
                                            variant="light"
                                            size="sm"
                                            className="border text-danger"
                                            title={`Delete ${entity.name}`}
                                            aria-label={`Delete ${entity.name}`}
                                            onClick={() => setToDelete(entity)}
                                        >
                                            <Trash />
                                        </Button>
                                    </td>
                                </tr>
                            )) : query !== "" ? (
                                <tr>
                                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                                        <EmptyMessage icon={<Search />}>
                                            could not find the entity you are looking for.
                                        </EmptyMessage>
                                    </td>
                                </tr>
                            ) : (
                                <tr>
                                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                                        <EmptyMessage icon={<InfoCircle />}>
                                            define your first entity — the reusable types your slots map to.
                                        </EmptyMessage>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                </Card.Body>
            </Card>
            <div className="mt-3">
                <AppPagination
                    page={page}
                    total={total}
                    perPage={PER_PAGE}
                    maxVisiblePages={MAX_VISIBLE_PAGES}
                    onPageChange={setPage}
                />
            </div>
            <EntityFormModal
                show={showForm}
                title={current ? "Edit entity" : "Create entity"}
                validated={validated}
                submitting={submitting}
                name={name}
                color={color}
                description={description}
                listType={listType}
                onHide={closeForm}
                onSubmit={handleSubmit}
                onNameChange={setName}
                onColorChange={setColor}
                onDescriptionChange={setDescription}
                onListTypeChange={setListType}
            />
            <DeleteConfirmationModal
                show={toDelete != null}
                title="Delete entity"
                items={toDelete ? [
                    // Deleting an entity cascades to the slots that map to it
                    // — across every intent — and their spans (MT-5).
                    `${toDelete.name} (removes ${toDelete.slots_count ?? 0} slot${(toDelete.slots_count ?? 0) === 1 ? "" : "s"} and ${toDelete.annotations_count ?? 0} annotated span${(toDelete.annotations_count ?? 0) === 1 ? "" : "s"})`
                ] : []}
                itemType="entity"
                submitting={submitting}
                onHide={() => setToDelete(null)}
                onDelete={handleDelete}
            />
        </>
    );
};

export default EntitiesBuild;
