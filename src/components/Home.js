import axios from "axios";
import React, { useContext, useState, useEffect } from "react";
import { Link } from 'react-router-dom'
import { Alert, Container, Row, Col, Dropdown, Form, InputGroup, Button, Table, Pagination, Modal, Spinner } from "react-bootstrap";
import { PlusLg, Download, Pen, Trash, InfoCircle } from "react-bootstrap-icons";
import { UserContext } from "../contexts/UserContext";

const Home = () => {
    const { user } = useContext(UserContext);

    const [search, setSearch] = useState('');
    const [alert, setAlert] = useState(null);
    const [models, setModels] = useState([]);
    const [filter, setFilter] = useState([]);
    const [data, setData] = useState([]);
    const [name, setName] = useState('');
    const [dataset, setDataset] = useState(null);
    const [header, setHeader] = useState(true);
    const [description, setDescription] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentModel, setCurrentModel] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [page, setPage] = useState(1);
    const itemsPerPage = 7;
    const maxVisiblePages =5;

    const handleOpenCreateForm = () => {
        setShowCreateForm(true);
    };

    const handleCloseCreateForm = () => {
        setValidated(false);
        setName('');
        setDataset(null);
        setHeader(false);
        setDescription('');
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
                data.append('description', description);
                const response = await axios.post(
                    '/api/models',
                    data,
                    {
                        headers: {
                            "Authorization": `Bearer ${user.token}`
                        }
                    }
                );
                setModels(response.data.models);
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                handleCloseCreateForm();
            }
        }
    };

    const handleDownload = async (model) => {
        try {
            const response = await axios.get(`/api/models/${model.id}?format=csv`, {
                responseType: 'blob',
                headers: {
                    "Authorization": `Bearer ${user.token}`
                }
            });
            const href = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = href;
            link.download = `${model.name}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleOpenEditForm = (model) => {
        setCurrentModel(model);
        setName(model.name);
        setDescription(model.description);
        setShowEditForm(true);
    };

    const handleCloseEditForm = () => {
        setCurrentModel(null);
        setValidated(false);
        setName('');
        setDescription('');
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
                data.append('description', description);
                const response = await axios.put(
                    `/api/models/${currentModel.id}`,
                    data,
                    {
                        headers: {
                            "Authorization": `Bearer ${user.token}`
                        }
                    }
                );
                setModels(response.data.models);
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                handleCloseEditForm();
            }
        }
    };

    const handleOpenDeleteConfirmation = (model) => {
        setCurrentModel(model);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setCurrentModel(null);
        setSubmitting(false);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const response = await axios.delete(
                `/api/models/${currentModel.id}`,
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setModels(response.data.models);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.message });
        } finally {
            handleCloseDeleteConfirmation();
        }
    };

    useEffect(() => {
        if (user) {
            const getModels = async () => {
                try {
                    const response = await axios.get(
                        '/api/models',
                        {
                            headers: {
                                "Authorization": `Bearer ${user.token}`
                            }
                        }
                    );
                    setModels(response.data.models);
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            };
            getModels();
        }
    }, [user])

    useEffect(() => {
        if (search !== '') {
            setFilter(models.filter((model) => model.name.toLowerCase().includes(search.toLowerCase())));
        } else {
            setFilter(models);
        }
    }, [models, search])

    useEffect(() => {
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        setData(filter.slice(start, end));
        if (filter.length > 0)
            setPage(Math.min(page, Math.ceil(filter.length / itemsPerPage)));
    }, [filter, page])

    return (
        <Container>
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <Button 
                        variant="light" 
                        style={{
                            border: '1px solid #212529' 
                        }} 
                        onClick={handleOpenCreateForm}
                    >
                        <PlusLg />&nbsp;create model
                    </Button>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for models..."
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
                                <th>created at</th>
                                <th>updated at</th>
                                <th>options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {models.length > 0 ? search !== '' && filter.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <i class="bi bi-ban" />&nbsp;could not find the model you are looking for.
                                    </td>
                                </tr>
                            ) : data.map((model, index) => (
                                <tr key={model.id}>
                                    <td>{(page - 1) * itemsPerPage + index + 1}.</td>
                                    <td>
                                        <Link 
                                            to={`/models/${model.id}/build`}
                                            style={{
                                                textDecorationLine: 'none'
                                            }}
                                        >
                                            {model.name}
                                        </Link>
                                    </td>
                                    <td>{model.created_at}</td>
                                    <td>{model.updated_at}</td>
                                    <td>
                                        <Dropdown>
                                            <Dropdown.Toggle size='sm' variant='light'>
                                                select
                                            </Dropdown.Toggle>
                                            <Dropdown.Menu>
                                                <Dropdown.Item onClick={() => handleDownload(model)}>
                                                    <Download />
                                                    &nbsp;
                                                    Download
                                                </Dropdown.Item>
                                                <Dropdown.Item onClick={() => handleOpenEditForm(model)}>
                                                    <Pen />
                                                    &nbsp;
                                                    Edit
                                                </Dropdown.Item>
                                                <Dropdown.Divider />
                                                <Dropdown.Item onClick={() => handleOpenDeleteConfirmation(model)}>
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
                                        colSpan={5}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <InfoCircle />&nbsp;looks like you have no models.
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
                        {[...Array(Math.ceil(filter.length / itemsPerPage))].map((_, i) => (
                            (i === 0 || i === Math.ceil(filter.length / itemsPerPage) - 1 || (i >= page - Math.floor(maxVisiblePages / 2) && i <= page + Math.floor(maxVisiblePages / 2))) ? (
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
                            onClick={() => setPage((prevPage) => Math.min(prevPage + 1, Math.ceil(filter.length / itemsPerPage)))}
                            disabled={page === Math.ceil(filter.length / itemsPerPage)}
                        />
                    </Pagination>}
                </Col>
            </Row>
            <Modal centered show={showCreateForm} onHide={handleCloseCreateForm}>
                <Modal.Header closeButton>
                    <Modal.Title>Create model</Modal.Title>
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
                                Choose a unique name for your model.
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
                        <Form.Group className="mb-3">
                            <Form.Label>Description</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                placeholder="Enter a description..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
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
                    <Modal.Title>Edit model</Modal.Title>
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
                                Choose a unique name for your model.
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
                        <Form.Group className="mb-3">
                            <Form.Label>Description</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                placeholder="Enter a description..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
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
                    <Modal.Title>Delete model</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the model "{currentModel?.name}"?</p>
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
        </Container>
    );
}

export default Home;