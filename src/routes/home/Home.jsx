import axios from "axios";
import { useContext, useEffect, useState } from "react";
import { Alert, Button, ButtonGroup, ButtonToolbar, Col, Container, Form, Row } from "react-bootstrap";
import { Download, Pen, PlusLg, Trash } from "react-bootstrap-icons";
import { UserContext } from "../../contexts/UserContext";
import AppPagination from "../../shared/components/AppPagination";
import DeleteConfirmationModal from "../../shared/components/DeleteConfirmationModal";
import useDebounce from "../../shared/hooks/useDebounce";
import downloadBlob from "../../shared/utils/downloadBlob";
import ModelFormModal from "./components/ModelFormModal";
import ModelsTable from "./components/ModelsTable";

const PER_PAGE = 7;
const MAX_VISIBLE_PAGES = 5;

const Home = () => {
    const { user } = useContext(UserContext);
    const [query, setQuery] = useState("");
    const [alert, setAlert] = useState(null);
    const [models, setModels] = useState([]);
    const [name, setName] = useState("");
    const [type, setType] = useState("text_classification");
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [description, setDescription] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentModel, setCurrentModel] = useState(null);
    const [modelsToDelete, setModelsToDelete] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const selectedModels = models.filter((model) => selectedIds.has(model.id));

    const toggleRowSelection = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAllSelection = (visibleModels) => {
        setSelectedIds((prev) => {
            const allSelected = visibleModels.length > 0 && visibleModels.every((model) => prev.has(model.id));
            return allSelected ? new Set() : new Set(visibleModels.map((model) => model.id));
        });
    };

    const debouncedQuery = useDebounce(query, 500);

    const resetForm = () => {
        setValidated(false);
        setName("");
        setType("text_classification");
        setDataset(null);
        setHeader(false);
        setDescription("");
        setSubmitting(false);
    };

    const closeCreateForm = () => {
        resetForm();
        setShowCreateForm(false);
    };

    const closeEditForm = () => {
        setCurrentModel(null);
        resetForm();
        setShowEditForm(false);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) {
            e.stopPropagation();
        }
        setValidated(true);

        if (name === "") return;

        try {
            setSubmitting(true);
            const data = new FormData();
            data.append("name", name);
            data.append("type", type);
            if (dataset) {
                data.append("dataset", dataset);
                data.append("header", header);
            }
            data.append("description", description);
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.post("/api/models", data, { headers });

            if (page === 1) {
                setModels((prevModels) => (
                    prevModels.length + 1 > PER_PAGE
                        ? [response.data, ...prevModels.slice(0, -1)]
                        : [response.data, ...prevModels]
                ));
                setTotal((prevTotal) => prevTotal + 1);
            } else {
                setPage(1);
            }
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            closeCreateForm();
        }
    };

    const handleDownload = async (model) => {
        try {
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.get(`/api/models/${model.id}?format=csv`, {
                responseType: "blob",
                headers
            });
            downloadBlob(response.data, `${model.name}.csv`);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    const handleOpenEditForm = (model) => {
        setCurrentModel(model);
        setName(model.name);
        setDescription(model.description);
        setShowEditForm(true);
    };

    const handleEdit = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) {
            e.stopPropagation();
        }
        setValidated(true);

        if (name === "") return;

        try {
            setSubmitting(true);
            const data = new FormData();
            data.append("name", name);
            if (dataset) {
                data.append("dataset", dataset);
                data.append("header", header);
            }
            data.append("description", description);
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.put(`/api/models/${currentModel.id}`, data, { headers });
            setModels((prevModels) => prevModels.map((m) => (m.id === currentModel.id ? response.data : m)));
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            closeEditForm();
        }
    };

    const handleOpenDeleteConfirmation = (modelsForDeletion) => {
        setModelsToDelete(modelsForDeletion);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setModelsToDelete([]);
        setShowDeleteConfirmation(false);
    };

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const headers = { Authorization: `Bearer ${user.token}` };
            const idsToDelete = modelsToDelete.map((model) => model.id);
            await Promise.all(idsToDelete.map((id) => axios.delete(`/api/models/${id}`, { headers })));

            const remainingOnPage = models.length - idsToDelete.length;
            if (remainingOnPage > 0) {
                setLoading(true);
                const params = { page, per_page: PER_PAGE };
                if (debouncedQuery !== "") params.query = debouncedQuery;
                const response = await axios.get("/api/models", { params, headers });
                setModels(response.data.models);
                setTotal(response.data.total);
            } else if (page > 1) {
                setPage(page - 1);
            } else {
                setModels([]);
                setTotal(0);
            }
            setSelectedIds((prev) => {
                const next = new Set(prev);
                idsToDelete.forEach((id) => next.delete(id));
                return next;
            });
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.message });
        } finally {
            setLoading(false);
            setSubmitting(false);
            handleCloseDeleteConfirmation();
        }
    };

    const handleBulkDownload = async () => {
        for (const model of selectedModels) {
            await handleDownload(model);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {
        setSelectedIds(new Set());
    }, [page, debouncedQuery]);

    useEffect(() => {
        if (user) {
            const getModels = async () => {
                try {
                    setLoading(true);
                    const headers = { Authorization: `Bearer ${user.token}` };
                    const params = { page, per_page: PER_PAGE };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const response = await axios.get("/api/models", { params, headers });
                    setModels(response.data.models);
                    setTotal(response.data.total);
                } catch (error) {
                    setAlert({ variant: "danger", message: error.response.data.error });
                } finally {
                    setLoading(false);
                }
            };
            getModels();
        }
    }, [user, page, debouncedQuery]);

    return (
        <Container fluid>
            <div className="page-context-bar" aria-hidden="true" />
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ButtonToolbar>
                        <ButtonGroup className="me-2">
                            <Button
                                variant="light"
                                className="border"
                                onClick={() => setShowCreateForm(true)}
                            >
                                <PlusLg />&nbsp;create model
                            </Button>
                        </ButtonGroup>
                        <ButtonGroup>
                            <Button
                                variant="light"
                                className="border"
                                title="Download selected"
                                aria-label="Download selected"
                                disabled={selectedModels.length === 0}
                                onClick={handleBulkDownload}
                            >
                                <Download />
                            </Button>
                            <Button
                                variant="light"
                                className="border"
                                title="Edit selected"
                                aria-label="Edit selected"
                                disabled={selectedModels.length !== 1}
                                onClick={() => handleOpenEditForm(selectedModels[0])}
                            >
                                <Pen />
                            </Button>
                            <Button
                                variant="light"
                                className="border text-danger"
                                title="Delete selected"
                                aria-label="Delete selected"
                                disabled={selectedModels.length === 0}
                                onClick={() => handleOpenDeleteConfirmation(selectedModels)}
                            >
                                <Trash />
                            </Button>
                        </ButtonGroup>
                    </ButtonToolbar>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for models..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ModelsTable
                        loading={loading}
                        models={models}
                        total={total}
                        query={debouncedQuery}
                        selectedIds={selectedIds}
                        onToggleRow={toggleRowSelection}
                        onToggleAll={toggleAllSelection}
                    />
                    <div className="mt-3">
                        <AppPagination
                            page={page}
                            total={total}
                            perPage={PER_PAGE}
                            maxVisiblePages={MAX_VISIBLE_PAGES}
                            onPageChange={setPage}
                        />
                    </div>
                </Col>
            </Row>
            <ModelFormModal
                show={showCreateForm}
                title="Create model"
                validated={validated}
                submitting={submitting}
                name={name}
                type={type}
                dataset={dataset}
                header={header}
                description={description}
                showType
                onHide={closeCreateForm}
                onSubmit={handleCreate}
                onNameChange={setName}
                onTypeChange={setType}
                onDatasetChange={setDataset}
                onHeaderChange={setHeader}
                onDescriptionChange={setDescription}
            />
            <ModelFormModal
                show={showEditForm}
                title="Edit model"
                validated={validated}
                submitting={submitting}
                name={name}
                type={type}
                dataset={dataset}
                header={header}
                description={description}
                onHide={closeEditForm}
                onSubmit={handleEdit}
                onNameChange={setName}
                onTypeChange={setType}
                onDatasetChange={setDataset}
                onHeaderChange={setHeader}
                onDescriptionChange={setDescription}
            />
            <DeleteConfirmationModal
                show={showDeleteConfirmation}
                title="Delete model"
                items={modelsToDelete.map((model) => model.name)}
                itemType="model"
                submitting={submitting}
                onHide={handleCloseDeleteConfirmation}
                onDelete={handleDelete}
            />
        </Container>
    );
};

export default Home;
