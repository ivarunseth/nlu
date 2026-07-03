import axios from "axios";
import { useContext, useEffect, useState } from "react";
import { Alert, Button, ButtonGroup, ButtonToolbar, Col, Form, Row } from "react-bootstrap";
import { Download, Pen, PlusLg, Trash } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import AppPagination from "../../../../shared/components/AppPagination";
import DeleteConfirmationModal from "../../../../shared/components/DeleteConfirmationModal";
import useDebounce from "../../../../shared/hooks/useDebounce";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import LabelFormModal from "./components/LabelFormModal";
import LabelsTable from "./components/LabelsTable";

const PER_PAGE = 7;
const MAX_VISIBLE_PAGES = 5;

const Build = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const [alert, setAlert] = useState(null);
    const [query, setQuery] = useState("");
    const [labels, setLabels] = useState([]);
    const [name, setName] = useState("");
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentLabel, setCurrentLabel] = useState(null);
    const [labelsToDelete, setLabelsToDelete] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const selectedLabels = labels.filter((label) => selectedIds.has(label.id));

    const toggleRowSelection = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAllSelection = (visibleLabels) => {
        setSelectedIds((prev) => {
            const allSelected = visibleLabels.length > 0 && visibleLabels.every((label) => prev.has(label.id));
            return allSelected ? new Set() : new Set(visibleLabels.map((label) => label.id));
        });
    };

    const debouncedQuery = useDebounce(query, 500);

    const resetForm = () => {
        setValidated(false);
        setName("");
        setDataset(null);
        setHeader(true);
        setSubmitting(false);
    };

    const closeCreateForm = () => {
        resetForm();
        setShowCreateForm(false);
    };

    const closeEditForm = () => {
        setCurrentLabel(null);
        resetForm();
        setShowEditForm(false);
    };

    const buildFormData = () => {
        const data = new FormData();
        data.append("name", name);
        if (dataset) {
            data.append("dataset", dataset);
            data.append("header", header);
        }
        return data;
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
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.post(`/api/models/${modelId}/labels`, buildFormData(), { headers });

            if (page === 1) {
                setLabels((prevLabels) => (
                    prevLabels.length + 1 > PER_PAGE
                        ? [response.data, ...prevLabels.slice(0, -1)]
                        : [response.data, ...prevLabels]
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

    const handleDownload = async (label) => {
        try {
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.get(`/api/models/${modelId}/labels/${label.id}?format=csv`, {
                responseType: "blob",
                headers
            });
            downloadBlob(response.data, `${label.name}-utterances.csv`);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    const handleOpenEditForm = (label) => {
        setCurrentLabel(label);
        setName(label.name);
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
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.put(
                `/api/models/${modelId}/labels/${currentLabel.id}`,
                buildFormData(),
                { headers }
            );
            setLabels((prevLabels) => prevLabels.map((l) => (l.id === currentLabel.id ? response.data : l)));
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            closeEditForm();
        }
    };

    const handleOpenDeleteConfirmation = (labelsForDeletion) => {
        setLabelsToDelete(labelsForDeletion);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setLabelsToDelete([]);
        setSubmitting(false);
        setShowDeleteConfirmation(false);
    };

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const headers = { Authorization: `Bearer ${user.token}` };
            const idsToDelete = labelsToDelete.map((label) => label.id);
            await Promise.all(idsToDelete.map((id) => axios.delete(`/api/models/${modelId}/labels/${id}`, { headers })));

            const remainingOnPage = labels.length - idsToDelete.length;
            if (remainingOnPage > 0) {
                setLoading(true);
                const params = { page, per_page: PER_PAGE };
                if (debouncedQuery !== "") params.query = debouncedQuery;
                const response = await axios.get(`/api/models/${modelId}/labels`, { params, headers });
                setLabels(response.data.labels);
                setTotal(response.data.total);
            } else if (page > 1) {
                setPage(page - 1);
            } else {
                setLabels([]);
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
            handleCloseDeleteConfirmation();
        }
    };

    const handleBulkDownload = async () => {
        for (const label of selectedLabels) {
            await handleDownload(label);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {
        setSelectedIds(new Set());
    }, [page, debouncedQuery]);

    useEffect(() => {
        if (user && modelId) {
            const getLabels = async () => {
                try {
                    setLoading(true);
                    const headers = { Authorization: `Bearer ${user.token}` };
                    const params = { page, per_page: PER_PAGE };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${modelId}/labels`, { params, headers });
                    setLabels(response.data.labels);
                    setTotal(response.data.total);
                } catch (error) {
                    setAlert({ variant: "danger", message: error.response.data.message });
                } finally {
                    setLoading(false);
                }
            };
            getLabels();
        }
    }, [user, modelId, page, debouncedQuery]);

    return (
        <>
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
                                <PlusLg />&nbsp;create label
                            </Button>
                        </ButtonGroup>
                        <ButtonGroup>
                            <Button
                                variant="light"
                                className="border"
                                title="Download selected"
                                aria-label="Download selected"
                                disabled={selectedLabels.length === 0}
                                onClick={handleBulkDownload}
                            >
                                <Download />
                            </Button>
                            <Button
                                variant="light"
                                className="border"
                                title="Edit selected"
                                aria-label="Edit selected"
                                disabled={selectedLabels.length !== 1}
                                onClick={() => handleOpenEditForm(selectedLabels[0])}
                            >
                                <Pen />
                            </Button>
                            <Button
                                variant="light"
                                className="border text-danger"
                                title="Delete selected"
                                aria-label="Delete selected"
                                disabled={selectedLabels.length === 0}
                                onClick={() => handleOpenDeleteConfirmation(selectedLabels)}
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
                            placeholder="search for labels..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <LabelsTable
                        modelId={modelId}
                        loading={loading}
                        labels={labels}
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
            <LabelFormModal
                show={showCreateForm}
                title="Create label"
                validated={validated}
                submitting={submitting}
                name={name}
                dataset={dataset}
                header={header}
                onHide={closeCreateForm}
                onSubmit={handleCreate}
                onNameChange={setName}
                onDatasetChange={setDataset}
                onHeaderChange={setHeader}
            />
            <LabelFormModal
                show={showEditForm}
                title="Edit label"
                validated={validated}
                submitting={submitting}
                name={name}
                dataset={dataset}
                header={header}
                onHide={closeEditForm}
                onSubmit={handleEdit}
                onNameChange={setName}
                onDatasetChange={setDataset}
                onHeaderChange={setHeader}
            />
            <DeleteConfirmationModal
                show={showDeleteConfirmation}
                title="Delete label"
                items={labelsToDelete.map((label) => label.name)}
                itemType="label"
                submitting={submitting}
                onHide={handleCloseDeleteConfirmation}
                onDelete={handleDelete}
            />
        </>
    );
};

export default Build;
