import React, { useContext, useState, useEffect } from "react";
import { Alert, Row, Col, Dropdown, Form, InputGroup, ButtonToolbar, ButtonGroup, Button, Table, Pagination, Modal, Spinner } from "react-bootstrap";
import { PlusLg, Download, Pen, Trash, InfoCircle } from "react-bootstrap-icons";
import { Link, useParams } from "react-router-dom";
import { UserContext } from "../contexts/UserContext";
import { ModelContext } from "../contexts/ModelContext";
import { useSocket } from "../contexts/SocketContext";
import axios from "axios";

const Build = () => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);
    const { model, setModel } = useContext(ModelContext);

    const socket = useSocket();

    const [alert, setAlert] = useState(null);
    const [search, setSearch] = useState('');
    const [labels, setLabels] = useState([]);
    const [filter, setFilter] = useState([]);
    const [data, setData] = useState([]);
    const [name, setName] = useState('');
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [status, setStatus] = useState(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentLabel, setCurrentLabel] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [page, setPage] = useState(1);

    const itemsPerPage = 5;

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
                const response = await axios.post(
                    `/api/models/${modelId}/labels`,
                    data,
                    {
                        headers: {
                            "Authorization": `Bearer ${user.token}`
                        }
                    }
                );
                setLabels(response.data.labels);
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                handleCloseCreateForm();
            }
        }
    };

    const handleTrain = async () => {
        try {
            const response = await axios.post(
                `/api/models/${modelId}/trainings`,
                {},
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setModel(response.data);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleDownload = async (label) => {
        try {
            const response = await axios.get(`/api/models/${modelId}/labels/${label.id}?format=csv`, {
                responseType: 'blob',
                headers: {
                    "Authorization": `Bearer ${user.token}`
                }
            });
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
                const response = await axios.put(
                    `/api/models/${modelId}/labels/${currentLabel.id}`,
                    data,
                    {
                        headers: {
                            "Authorization": `Bearer ${user.token}`
                        }
                    }
                );
                setLabels(response.data.labels);
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
            const response = await axios.delete(
                `/api/models/${model.id}/labels/${currentLabel.id}`,
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setLabels(response.data.labels);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.message });
        } finally {
            handleCloseDeleteConfirmation();
        }
    };

    useEffect(() => {
        if (user && socket && model) {
            socket.on('status', (data) => {
                setStatus(data.status);
                if (data.status === 'SUCCESS' || data.status === 'FAILURE') {
                    socket.emit('leave', data.task_id);
                }
            });
            if (model.training) {
                if (model.training.status !== 'SUCCESS' && model.training.status !== 'FAILURE') {
                    socket.emit('join', model.training.task_id);
                    socket.emit('status', {
                        'token': user.token,
                        'model_id': model.id,
                        'task_id': model.training.task_id
                    });
                }
            }
            return () => {
                socket.off('status');
            };
        }
    }, [user, socket, model])


    useEffect(() => {
        if (user && modelId) {
            const getLabels = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}/labels`,
                        {
                            headers: {
                                "Authorization": `Bearer ${user.token}`
                            }
                        }
                    );
                    setLabels(response.data.labels)
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.message });
                }
            };
            getLabels();
        }
    }, [user, modelId])

    useEffect(() => {
        if (search !== '') {
            setFilter(labels.filter((label) => label.name.toLowerCase().includes(search.toLowerCase())));
        } else {
            setFilter(labels);
        }
    }, [labels, search])

    useEffect(() => {
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        setData(filter.slice(start, end));
        if (filter.length > 0)
            setPage(Math.min(page, Math.ceil(filter.length / itemsPerPage)));
    }, [filter, page])

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
                                    border: '1px solid #212529'
                                }}
                                onClick={handleOpenCreateForm}
                            >
                                <PlusLg />&nbsp;create label
                            </Button>
                        </ButtonGroup>
                        <ButtonGroup>
                            {status === 'PENDING' || status === 'RECEIVED' ?
                                <Button
                                    variant="light"
                                    disabled
                                    style={{
                                        border: '1px solid #212529'
                                    }}
                                >
                                    <Spinner
                                        animation="border"
                                        size="sm"
                                    />
                                    &nbsp;pending...
                                </Button>
                                : status === 'STARTED' ?
                                    <Button
                                        variant="light"
                                        disabled
                                        style={{
                                            border: '1px solid #212529'
                                        }}
                                    >
                                        <Spinner
                                            animation="grow"
                                            size="sm"
                                        />
                                        &nbsp;training...
                                    </Button> :
                                    <Button
                                        variant="light"
                                        onClick={handleTrain}
                                        disabled={labels.length < 2 || labels.reduce((prev, next) => prev + next.utterances_count, 0) === 0}
                                        style={{
                                            border: '1px solid #212529'
                                        }}
                                    >
                                        <i className="bi bi-vignette" />&nbsp;train
                                    </Button>}
                        </ButtonGroup>
                    </ButtonToolbar>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for labels..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
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
                            {labels.length > 0 ? search !== '' && filter.length === 0 ? (
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
                            ) : data.map((label, index) => (
                                <tr key={label.id}>
                                    <td>{(page - 1) * itemsPerPage + index + 1}.</td>
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
                            )) : (
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
                    {filter.length > itemsPerPage &&
                        <Pagination size='sm'>
                            <Pagination.Prev
                                onClick={() => setPage((prevPage) => Math.max(prevPage - 1, 1))}
                                disabled={page === 1}
                            />
                            {Array.from({ length: Math.ceil(filter.length / itemsPerPage) }, (_, index) => (
                                <Pagination.Item
                                    key={index + 1}
                                    active={index + 1 === page}
                                    onClick={() => setPage(index + 1)}
                                >
                                    {index + 1}
                                </Pagination.Item>
                            ))}
                            <Pagination.Next
                                onClick={() => setPage((prevPage) => Math.min(prevPage + 1, Math.ceil(filter.length / itemsPerPage)))}
                                disabled={page === Math.ceil(filter.length / itemsPerPage)}
                            />
                        </Pagination>}
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