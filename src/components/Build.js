import React, { useContext, useState, useEffect } from "react";
import { Alert, Row, Col, Dropdown, Form, FormGroup, InputGroup, ButtonToolbar, ButtonGroup, Button, Table, Pagination, Modal, Spinner, OverlayTrigger, Popover } from "react-bootstrap";
import { PlusLg, Sliders, Download, Pen, Trash, InfoCircle, QuestionCircle } from "react-bootstrap-icons";
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
    const [paramters, setParameters] = useState({
        test_split: 0.1,
        validation_split: 0.1,
        epochs: 200,
        batch_size: 32,
        embedding_dims: 64,
        dropout: 0.2,
        early_stopping: true,
        monitor: 'val_loss',
        patience: 10,
        pruning: true,
        save_format: 'tf'
    })
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
    const [showParameters, setShowParameters] = useState(false);
    const [currentLabel, setCurrentLabel] = useState(null);
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [page, setPage] = useState(1);
    const itemsPerPage = 7;
    const maxVisiblePages = 5;

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
                paramters,
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
                `/api/models/${modelId}/labels/${currentLabel.id}`,
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
                    socket.emit('status', {'task_id': model.training.task_id});
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
                        {status === 'PENDING' || status === 'RECEIVED' ?
                        <ButtonGroup>
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
                        </ButtonGroup> :
                        status === 'STARTED' ?
                        <ButtonGroup>
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
                            </Button>
                        </ButtonGroup> :
                        <ButtonGroup>
                            <Button
                                variant="light"
                                disabled={labels.length < 2 || labels.reduce((prev, next) => prev + next.utterances_count, 0) === 0}
                                style={{
                                    border: '1px solid #212529'
                                }}
                                onClick={() => setShowParameters(true)}
                            >
                                <Sliders />
                            </Button>
                            <Button
                                variant="light"
                                disabled={labels.length < 2 || labels.reduce((prev, next) => prev + next.utterances_count, 0) === 0}
                                onClick={handleTrain}
                                style={{
                                    border: '1px solid #212529'
                                }}
                            >
                                train
                            </Button>
                        </ButtonGroup>}
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
            <Modal size="lg" centered show={showParameters} onHide={() => setShowParameters(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        Parameters&nbsp;
                        <OverlayTrigger
                            placement='bottom'
                            overlay={
                                <Popover>
                                    <Popover.Header as="h3"><InfoCircle />&nbsp;Parameters</Popover.Header>
                                    <Popover.Body>
                                        Configurations set before training which influence the learning process. <strong>Only saved after training is completed successfully.</strong>
                                    </Popover.Body>
                                </Popover>
                            }
                        >
                            <QuestionCircle />
                        </OverlayTrigger>
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                    test split&nbsp;
                                    <OverlayTrigger
                                        placement='bottom'
                                        overlay={
                                            <Popover>
                                                <Popover.Header as="h3"><InfoCircle />&nbsp;test split</Popover.Header>
                                                <Popover.Body>
                                                    The division of dataset used for evaluating the performance of model.
                                                </Popover.Body>
                                            </Popover>
                                        }
                                    >
                                        <QuestionCircle />
                                    </OverlayTrigger>
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.test_split}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, test_split: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.test_split}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, test_split: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                validation split&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.validation_split}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, validation_split: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.validation_split}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, validation_split: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                epochs&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={1}
                                    max={1000}
                                    step={1}
                                    value={paramters.epochs}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, epochs: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={1}
                                    max={1000}
                                    step={1}
                                    value={paramters.epochs}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, epochs: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                batch size&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={4}
                                    max={128}
                                    step={4}
                                    value={paramters.batch_size}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, batch_size: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={4}
                                    max={128}
                                    step={4}
                                    value={paramters.batch_size}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, batch_size: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                embedding dimensions&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={32}
                                    max={256}
                                    step={8}
                                    value={paramters.embedding_dims}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, embedding_dims: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={32}
                                    max={256}
                                    step={8}
                                    value={paramters.embedding_dims}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, embedding_dims: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                dropout&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.dropout}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, dropout: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    type='number'
                                    min={0.0}
                                    max={1.0}
                                    step={0.05}
                                    value={paramters.dropout}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, dropout: parseFloat(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                early stopping&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='8'>
                                <Form.Check
                                    type='switch'
                                    onChange={(e) => { setParameters({ ...paramters, early_stopping: e.target.checked }) }}
                                    checked={paramters.early_stopping}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm='4'>
                                monitor&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='3'>
                                <Form.Select
                                    disabled={!paramters.early_stopping}
                                    value={paramters.monitor}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, monitor: e.target.value })
                                    }}
                                >
                                    {labels.length === 2 ? 
                                        <option value='binary_accuracy'>
                                            binary accuracy
                                        </option> : 
                                        <option value='accuracy'>
                                            accuracy
                                        </option>}
                                    <option value='loss'>loss</option>
                                    {labels.length === 2 ? 
                                        <option value='val_binary_accuracy'>
                                            validation binary accuracy
                                        </option> : 
                                        <option value='val_accuracy'>
                                            validation accuracy
                                        </option>}
                                    <option value='val_loss' selected>validation loss</option>
                                </Form.Select>
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                patience&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="6">
                                <Form.Range
                                    disabled={!paramters.early_stopping}
                                    min={1}
                                    max={50}
                                    step={1}
                                    value={paramters.patience}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, patience: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                            <Col sm="2">
                                <Form.Control
                                    disabled={!paramters.early_stopping}
                                    type='number'
                                    min={1}
                                    max={50}
                                    step={1}
                                    value={paramters.patience}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, patience: parseInt(e.target.value) })
                                    }}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4">
                                pruning&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='8'>
                                <Form.Check
                                    type='switch'
                                    onChange={(e) => { setParameters({ ...paramters, pruning: e.target.checked }) }}
                                    checked={paramters.pruning}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm='4'>
                                save format&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='3'>
                                <Form.Select
                                    value={paramters.save_format}
                                    onChange={(e) => {
                                        setParameters({ ...paramters, save_format: e.target.value })
                                    }}
                                >
                                    <option value='tf' selected>tf</option>
                                    <option value='keras'>keras</option>
                                    <option value='h5'>h5</option>
                                    <option value='tflite'>tflite</option>
                                    <option value='onnx'>onnx</option>
                                </Form.Select>
                            </Col>
                        </FormGroup>
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