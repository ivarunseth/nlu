import { useApi } from "../../contexts/ApiContext";
import { useContext, useEffect, useState } from "react";
import { Alert, Button, ButtonGroup, ButtonToolbar, Col, Form, Row } from "react-bootstrap";
import { PlusLg } from "react-bootstrap-icons";
import { UserContext } from "../../contexts/UserContext";
import AppPagination from "../../shared/components/AppPagination";
import { TableFilters, FilterChips } from "../../shared/components/TableFilters";
import useDebounce from "../../shared/hooks/useDebounce";
import useTableControls from "../../shared/hooks/useTableControls";
import downloadBlob from "../../shared/utils/downloadBlob";
import ModelFormModal from "./components/ModelFormModal";
import PageShell from "../../shared/components/PageShell";
import ModelsTable from "./components/ModelsTable";

const PER_PAGE = 7;
const MAX_VISIBLE_PAGES = 5;

// The model kinds surfaced as a type filter, matching ALLOWED_MODELS.
const MODEL_KIND_OPTIONS = [
    { value: "text_classification", label: "Text classification" },
    { value: "named_entity_recognition", label: "Named entity recognition" },
    { value: "natural_language_understanding", label: "Natural language understanding" }
];

const MODEL_FILTERS = [
    { name: "kind", label: "Type", options: MODEL_KIND_OPTIONS }
];

const Home = () => {
    const { user } = useContext(UserContext);
    const api = useApi();
    const [query, setQuery] = useState("");
    const [alert, setAlert] = useState(null);
    const [models, setModels] = useState([]);
    const [name, setName] = useState("");
    const [type, setType] = useState("text_classification");
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [description, setDescription] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const controls = useTableControls({
        defaultSort: { field: "created_at", order: "desc" },
        filters: MODEL_FILTERS,
        onChange: () => setPage(1)
    });

    const debouncedQuery = useDebounce(query, 500);
    // Stable dependency for the fetch effect: params is a fresh object each
    // render, so key the refetch on its serialized contents instead.
    const controlsKey = JSON.stringify(controls.params);

    // Annotated datasets import row-by-row and report skipped rows in an
    // import_summary riding on the model payload; surface it so a partial
    // import never goes unnoticed.
    const importAlert = (summary) => {
        if (!summary) return null;
        const skipped = summary.errors.length;
        let message = `Imported ${summary.imported} utterance${summary.imported === 1 ? "" : "s"}`;
        if (summary.created.length > 0) {
            message += `, created ${summary.created.length} definition${summary.created.length === 1 ? "" : "s"} (intents, entities and slots)`;
        }
        if (skipped > 0) {
            const first = summary.errors[0];
            message += `. Skipped ${skipped} row${skipped === 1 ? "" : "s"} — e.g. line ${first.line}: ${first.error}`;
        } else {
            message += ".";
        }
        return { variant: skipped > 0 ? "warning" : "success", message };
    };

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
            data.append("kind", type);
            if (dataset) {
                data.append("dataset", dataset);
                data.append("header", header);
            }
            data.append("description", description);
            const { import_summary: importSummary, ...createdModel } = await api.models.create(data);

            if (page === 1) {
                setModels((prevModels) => (
                    prevModels.length + 1 > PER_PAGE
                        ? [createdModel, ...prevModels.slice(0, -1)]
                        : [createdModel, ...prevModels]
                ));
                setTotal((prevTotal) => prevTotal + 1);
            } else {
                setPage(1);
            }
            if (importSummary) setAlert(importAlert(importSummary));
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            closeCreateForm();
        }
    };

    const handleDownload = async (model) => {
        try {
            downloadBlob(await api.models.exportCsv(model.id), `${model.name}.csv`);
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {
        if (user) {
            const getModels = async () => {
                try {
                    setLoading(true);
                    const params = { page, per_page: PER_PAGE, ...controls.params };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const { models: page_models, total } = await api.models.list(params);
                    setModels(page_models);
                    setTotal(total);
                } catch (error) {
                    setAlert({ variant: "danger", message: error.response.data.error });
                } finally {
                    setLoading(false);
                }
            };
            getModels();
        }
    }, [api, user, page, debouncedQuery, controlsKey]);

    return (
        <PageShell>
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
                                variant="primary"
                                onClick={() => setShowCreateForm(true)}
                            >
                                <PlusLg />&nbsp;create model
                            </Button>
                        </ButtonGroup>
                        <TableFilters controls={controls} dateRange />
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
            <FilterChips controls={controls} className="mt-3" />
            <Row className="mt-4">
                <Col>
                    <ModelsTable
                        loading={loading}
                        models={models}
                        total={total}
                        query={debouncedQuery}
                        controls={controls}
                        onDownload={handleDownload}
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
        </PageShell>
    );
};

export default Home;
