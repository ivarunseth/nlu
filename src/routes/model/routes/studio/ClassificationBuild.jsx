import { useApi } from "../../../../contexts/ApiContext";
import { useContext, useEffect, useState } from "react";
import { Alert, Button, ButtonGroup, ButtonToolbar, Col, Form, Row } from "react-bootstrap";
import { PlusLg } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import AppPagination from "../../../../shared/components/AppPagination";
import DeleteConfirmationModal from "../../../../shared/components/DeleteConfirmationModal";
import { TableFilters, FilterChips } from "../../../../shared/components/TableFilters";
import useDebounce from "../../../../shared/hooks/useDebounce";
import useTableControls from "../../../../shared/hooks/useTableControls";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import LabelFormModal from "./components/LabelFormModal";
import LabelsTable from "./components/LabelsTable";

const PER_PAGE = 7;
const MAX_VISIBLE_PAGES = 5;

// Also serves as the Intents tab of a language understanding model: `noun`
// renames the surfaces, `labelLink` reroutes a row's drill-in (an intent
// opens its workspace, not the utterances page) and `onMutate` tells the
// parent a create/delete changed the totals its overview strip reports,
// while the flow itself stays the classification one.
const ClassificationBuild = ({ noun = "label", labelLink, onMutate }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const api = useApi();
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
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const controls = useTableControls({
        defaultSort: { field: "name", order: "asc" },
        onChange: () => setPage(1)
    });

    const debouncedQuery = useDebounce(query, 500);
    const controlsKey = JSON.stringify(controls.params);

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
            const created = await api.intents.create(modelId, buildFormData());

            if (page === 1) {
                setLabels((prevLabels) => (
                    prevLabels.length + 1 > PER_PAGE
                        ? [created, ...prevLabels.slice(0, -1)]
                        : [created, ...prevLabels]
                ));
                setTotal((prevTotal) => prevTotal + 1);
            } else {
                setPage(1);
            }
            onMutate?.();
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            closeCreateForm();
        }
    };

    const handleDownload = async (label) => {
        try {
            downloadBlob(await api.intents.exportCsv(modelId, label.id), `${label.name}-utterances.csv`);
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
            const updated = await api.intents.update(modelId, currentLabel.id, buildFormData());
            setLabels((prevLabels) => prevLabels.map((l) => (l.id === currentLabel.id ? updated : l)));
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
            const idsToDelete = labelsToDelete.map((label) => label.id);
            await Promise.all(idsToDelete.map((id) => api.intents.remove(modelId, id)));

            const remainingOnPage = labels.length - idsToDelete.length;
            if (remainingOnPage > 0) {
                setLoading(true);
                const params = { page, per_page: PER_PAGE };
                if (debouncedQuery !== "") params.query = debouncedQuery;
                const { intents, total } = await api.intents.list(modelId, params);
                setLabels(intents);
                setTotal(total);
            } else if (page > 1) {
                setPage(page - 1);
            } else {
                setLabels([]);
                setTotal(0);
            }
            onMutate?.();
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.message });
        } finally {
            setLoading(false);
            handleCloseDeleteConfirmation();
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {
        if (user && modelId) {
            const getLabels = async () => {
                try {
                    setLoading(true);
                    const params = { page, per_page: PER_PAGE, ...controls.params };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const { intents, total } = await api.intents.list(modelId, params);
                    setLabels(intents);
                    setTotal(total);
                } catch (error) {
                    setAlert({ variant: "danger", message: error.response.data.message });
                } finally {
                    setLoading(false);
                }
            };
            getLabels();
        }
    }, [user, modelId, page, debouncedQuery, controlsKey]);

    return (
        <>
            {alert && <Alert className="mt-4" variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
            {/* Create, filters and search share one row at every width, as
                on the Entities tab; the search box takes what is left. */}
            <Row className="mt-4 g-2 align-items-center">
                <Col xs="auto">
                    <ButtonToolbar className="flex-nowrap">
                        <ButtonGroup className="me-2">
                            <Button
                                variant="primary"
                                onClick={() => setShowCreateForm(true)}
                            >
                                <PlusLg />&nbsp;create {noun}
                            </Button>
                        </ButtonGroup>
                        <TableFilters controls={controls} dateRange />
                    </ButtonToolbar>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder={`search for ${noun}s...`}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <FilterChips controls={controls} className="mt-3" />
            <Row className="mt-4">
                <Col>
                    <LabelsTable
                        modelId={modelId}
                        noun={noun}
                        loading={loading}
                        labels={labels}
                        total={total}
                        query={debouncedQuery}
                        controls={controls}
                        onDownload={handleDownload}
                        onEdit={handleOpenEditForm}
                        onDelete={(label) => handleOpenDeleteConfirmation([label])}
                        labelLink={labelLink}
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
                title={`Create ${noun}`}
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
                title={`Edit ${noun}`}
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
                title={`Delete ${noun}`}
                items={labelsToDelete.map((label) => (
                    // Deleting an intent cascades to its utterances and their
                    // slot annotations; the confirmation says how many go.
                    noun === "intent"
                        ? `${label.name} (removes ${label.utterances_count} utterance${label.utterances_count === 1 ? "" : "s"} and their slot annotations)`
                        : label.name
                ))}
                itemType={noun}
                submitting={submitting}
                onHide={handleCloseDeleteConfirmation}
                onDelete={handleDelete}
            />
        </>
    );
};

export default ClassificationBuild;
