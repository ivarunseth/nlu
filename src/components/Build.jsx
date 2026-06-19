import React, { useContext, useState, useEffect } from "react";
import { Alert, Row, Col, Dropdown, Form, InputGroup, ButtonToolbar, ButtonGroup, Button, Table, Pagination, Modal, Spinner } from "react-bootstrap";
import { PlusLg, Download, Pen, Trash, InfoCircle } from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
import { UserContext } from "../contexts/UserContext";
import useDebounce from "../useDebounce";
import axios from "axios";

const Build = () => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);

    const [alert, setAlert] = useState(null);
    const [query, setQuery] = useState('');
    const [labels, setLabels] = useState([]);
    const [name, setName] = useState('');
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentLabel, setCurrentLabel] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const perPage = 7;
    const maxVisiblePages = 5;

    const debouncedQuery = useDebounce(query, 500);

    const handleOpenCreateForm = () => {
        setShowCreateForm(true);
    };

    const handleCloseCreateForm = () => {
        setValidated(false);
        setName('');
        setSubmitting(false);
        setShowCreateForm(false);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity())
            e.stopPropagation();
        setValidated(true);
        if (name !== '') {
            try {
                setSubmitting(true);
                const data = new FormData();
                data.append('name', name);
                if (dataset) {
                    data.append('dataset', dataset);
                    data.append('header', header);
                }
                const headers = {"Authorization": `Bearer ${user.token}`} 
                const response = await axios.post(`/api/models/${modelId}/labels`, data, { headers });
                if (page === 1) {
                    if (labels.length + 1 > perPage) {
                        setLabels([response.data, ...labels.slice(0, -1)]);
                    } else {
                        setLabels([response.data, ...labels]);
                    }
                    setTotal(total + 1);
                } else {
                    setPage(1);
                }
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                handleCloseCreateForm();
            }
        }
    };

    const handleDownload = async (label) => {
        try {
            const headers = {"Authorization": `Bearer ${user.token}`}
            const response = await axios.get(`/api/models/${modelId}/labels/${label.id}?format=csv`, { responseType: 'blob', headers });
            const href = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = href;
            link.download = `${label.name}-utterances.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleOpenEditForm = (label) => {
        setCurrentLabel(label);
        setName(label.name);
        setShowEditForm(true);
    };

    const handleCloseEditForm = () => {
        setCurrentLabel(null);
        setValidated(false);
        setName('');
        setSubmitting(false);
        setShowEditForm(false);
    };

    const handleEdit = async (e) => {
        e.preventDefault();
        if (!e.currentTarget.checkValidity())
            e.stopPropagation();
        setValidated(true);
        if (name !== '') {
            try {
                setSubmitting(true);
                const data = new FormData();
                data.append('name', name);
                if (dataset) {
                    data.append('dataset', dataset);
                    data.append('header', header);
                }
                const headers = {"Authorization": `Bearer ${user.token}`}
                const response = await axios.put(`/api/models/${modelId}/labels/${currentLabel.id}`, data, { headers });
                setLabels(prevLabels => prevLabels.map((l) => l.id === currentLabel.id ? response.data : l));
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                handleCloseEditForm();
            }
        }
    };

    const handleOpenDeleteConfirmation = (label) => {
        setCurrentLabel(label);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setCurrentLabel(null);
        setSubmitting(false);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const headers = {"Authorization": `Bearer ${user.token}`}
            await axios.delete(`/api/models/${modelId}/labels/${currentLabel.id}`, { headers });
            if (labels.length - 1 > 0) {
                setLoading(true);
                if (page === Math.ceil((total) / perPage)) {
                    setLabels(prevLabels => prevLabels.filter((l) => l.id !== currentLabel.id));
                    setTotal(total - 1);
                } else {
                    let params = { page: page, per_page: perPage }
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery
                    const response = await axios.get(`/api/models`, { params, headers });
                    setLabels(response.data.labels);
                    setTotal(response.data.total);
                }
                setLoading(false);
            } else {
                if (page > 1) {
                    setPage(page - 1);
                } else {
                    setLabels([]);
                    setTotal(0);
                }
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.message });
        } finally {
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
                    const headers = {"Authorization": `Bearer ${user.token}`};
                    let params = { page: page, per_page: perPage };
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${modelId}/labels`, { params, headers });
                    setLabels(response.data.labels);
                    setTotal(response.data.total);
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.message });
                } finally {
                    setLoading(false);
                }
            };
            getLabels();
        }
    }, [user, modelId, page, perPage, debouncedQuery])

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
                                style={{
                                    border: '1px solid #dee2e6'
                                }}
                                onClick={handleOpenCreateForm}
                            >
                                <PlusLg />&nbsp;create label
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
                    <Table
                        responsive
                        hover
                        style={{
                            minHeight: '33vh',
                            textAlign: 'center'
                        }}
                    >
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>name</th>
                                <th>count of utterances</th>
                                <th>created at</th>
                                <th>updated at</th>
                                <th>options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <Spinner animation='border' size='lg'/>
                                    </td>
                                </tr>
                            ) : total > 0 ? labels.map((label, index) => (
                                <tr key={label.id}>
                                    <td>{(page - 1) * perPage + index + 1}.</td>
                                    <td>
                                        <Link
                                            to={`/models/${modelId}/build/${label.id}/utterances`}
                                            style={{
                                                textDecorationLine: 'none'
                                            }}
                                        >
                                            {label.name}
                                        </Link>
                                    </td>
                                    <td>{label.utterances_count}</td>
                                    <td>{label.created_at}</td>
                                    <td>{label.updated_at}</td>
                                    <td>
                                        <Dropdown>
                                            <Dropdown.Toggle size='sm' variant='light'>
                                                select
                                            </Dropdown.Toggle>
                                            <Dropdown.Menu>
                                                <Dropdown.Item onClick={() => handleDownload(label)}>
                                                    <Download />
                                                    &nbsp;
                                                    Download
                                                </Dropdown.Item>
                                                <Dropdown.Item onClick={() => handleOpenEditForm(label)}>
                                                    <Pen />
                                                    &nbsp;
                                                    Edit
                                                </Dropdown.Item>
                                                <Dropdown.Divider />
                                                <Dropdown.Item onClick={() => handleOpenDeleteConfirmation(label)}>
                                                    <Trash />
                                                    &nbsp;
                                                    Delete
                                                </Dropdown.Item>
                                            </Dropdown.Menu>
                                        </Dropdown>
                                    </td>
                                </tr>
                            )) : debouncedQuery !== '' ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <i class="bi bi-ban" />&nbsp;could not find the label you are looking for.
                                    </td>
                                </tr>
                            ) : (
                                <tr>
                                    <td
                                        colSpan={6}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <InfoCircle />&nbsp;looks like you have no labels.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                    {total > perPage &&
                        <Pagination>
                            <Pagination.Prev
                                onClick={() => setPage((prevPage) => Math.max(prevPage - 1, 1))}
                                disabled={page === 1}
                            />
                            {[...Array(Math.ceil(total / perPage))].map((_, i) => (
                                (i === 0 || i === Math.ceil(total / perPage) - 1 || (i >= page - Math.floor(maxVisiblePages / 2) && i <= page + Math.floor(maxVisiblePages / 2))) ? (
                                    <Pagination.Item
                                        key={i + 1}
                                        active={i + 1 === page}
                                        onClick={() => setPage(i + 1)}
                                    >
                                        {i + 1}
                                    </Pagination.Item>
                                ) : (i === page - Math.floor(maxVisiblePages / 2) - 1 || i === page + Math.floor(maxVisiblePages / 2) + 1 ?
                                    <Pagination.Ellipsis key={`ellipsis-${i}`} /> : null
                                )
                            ))}
                            <Pagination.Next
                                onClick={() => setPage((prevPage) => Math.min(prevPage + 1, Math.ceil(total / perPage)))}
                                disabled={page === Math.ceil(total / perPage)}
                            />
                        </Pagination>
                    }
                </Col>
            </Row>
            <Modal centered show={showCreateForm} onHide={handleCloseCreateForm}>
                <Modal.Header closeButton>
                    <Modal.Title>Create label</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form noValidate validated={validated} onSubmit={handleCreate}>
                        <Form.Group className="mb-3">
                            <Form.Label>Name</Form.Label>
                            <InputGroup hasValidation>
                                <Form.Control
                                    type="text"
                                    placeholder="Enter a name..."
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoFocus
                                    required
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please enter a name.
                                </Form.Control.Feedback>
                            </InputGroup>
                            <Form.Text muted>
                                Choose a unique name for the label.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Dataset</Form.Label>
                            <Form.Control
                                type="file"
                                onChange={(e) => setDataset(e.target.files[0])}
                            />
                            <Form.Text muted>
                                You can optionally upload a dataset containing comma or tab separated text and labels.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Check
                                type='checkbox'
                                label='contains header'
                                disabled={!dataset}
                                onChange={(e) => setHeader(e.target.checked)}
                                checked={header}
                            />
                            <Form.Text muted>
                                Check only if the dataset contains a header with column names.
                            </Form.Text>
                        </Form.Group>
                        <div className="d-grid gap-2">
                            <Button
                                type="submit"
                                variant="primary"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Spinner
                                            animation="border"
                                            size="sm"
                                        />
                                        &nbsp;
                                        Submitting...
                                    </>
                                ) : (
                                    'Submit'
                                )}
                            </Button>
                        </div>
                    </Form>
                </Modal.Body>
            </Modal>
            <Modal centered show={showEditForm} onHide={handleCloseEditForm}>
                <Modal.Header closeButton>
                    <Modal.Title>Edit label</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form noValidate validated={validated} onSubmit={handleEdit}>
                        <Form.Group className="mb-3">
                            <Form.Label>Name</Form.Label>
                            <InputGroup hasValidation>
                                <Form.Control
                                    type="text"
                                    placeholder="Enter a name..."
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoFocus
                                    required
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please enter a name.
                                </Form.Control.Feedback>
                            </InputGroup>
                            <Form.Text muted>
                                Choose a unique name for the label.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Dataset</Form.Label>
                            <Form.Control
                                type="file"
                                onChange={(e) => setDataset(e.target.files[0])}
                            />
                            <Form.Text muted>
                                You can optionally upload a dataset containing comma or tab separated text and labels.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Check
                                type='checkbox'
                                label='contains header'
                                disabled={!dataset}
                                onChange={(e) => setHeader(e.target.checked)}
                                checked={header}
                            />
                            <Form.Text muted>
                                Check only if the dataset contains a header with column names.
                            </Form.Text>
                        </Form.Group>
                        <div className="d-grid gap-2">
                            <Button
                                type="submit"
                                variant="primary"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Spinner
                                            animation="border"
                                            size="sm"
                                        />
                                        &nbsp;
                                        Submitting...
                                    </>
                                ) : (
                                    'Submit'
                                )}
                            </Button>
                        </div>
                    </Form>
                </Modal.Body>
            </Modal>
            <Modal centered show={showDeleteConfirmation} onHide={handleCloseDeleteConfirmation}>
                <Modal.Header closeButton>
                    <Modal.Title>Delete label</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the label "{currentLabel?.name}"?</p>
                    <Button
                        type="submit"
                        variant="danger"
                        disabled={submitting}
                        onClick={() => handleDelete()}
                    >
                        {submitting ? (
                            <>
                                <Spinner
                                    animation="border"
                                    size="sm"
                                />
                                &nbsp;
                                Deleting...
                            </>
                        ) : (
                            'Delete'
                        )}
                    </Button>
                </Modal.Body>
            </Modal>
        </>
    );
}

export default Build;