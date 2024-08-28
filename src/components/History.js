import { useContext, useEffect, useState, useRef } from "react";
import { Alert, Button, ButtonGroup, Col, Row, Form, FormGroup, OverlayTrigger, Popover, Spinner, Table, Dropdown, Pagination, Modal } from "react-bootstrap";
import { InfoCircle, Download, PlusSlashMinus, Book, Bug, Sliders, Trash, QuestionCircle, ArrowClockwise } from "react-bootstrap-icons";
import ReactDiffViewer from 'react-diff-viewer';
import { UserContext } from "../contexts/UserContext";
import { ModelContext } from "../contexts/ModelContext";
import { useSocket } from "../contexts/SocketContext";
import { useParams } from "react-router-dom";
import useDebounce from '../useDebounce';
import axios from "axios";


const History = () => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);

    const socket = useSocket();

    const [paramters, setParameters] = useState({
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
    });
    const [query, setQuery] = useState('');
    const [alert, setAlert] = useState(null);
    const [trainings, setTrainings] = useState([]);
    const [currentTraining, setCurrentTraining] = useState(null);
    const [showParameters, setShowParameters] = useState(false);
    const [showChanges, setShowChanges] = useState(false);
    const [result, setResult] = useState(null)
    const [showResults, setShowResults] = useState(false);
    const [traceback, setTraceback] = useState(null);
    const [showTraceback, setShowTraceback] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [selectedTraining, setSelectedTraining] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const pageRef = useRef(page);
    const [total, setTotal] = useState(0);
    const perPage = 7;
    const maxVisiblePages = 5;
    
    const debouncedQuery = useDebounce(query, 500);

    const rooms = useRef(new Set())

    const handleTrain = async () => {
        try {
            const headers = {"Authorization": `Bearer ${user.token}`};
            const response = await axios.post(`/api/models/${modelId}/trainings`, paramters, { headers });
            setCurrentTraining(response.data);
            if (page === 1) {
                if (total + 1 > perPage) {
                    setTrainings(prev => [response.data, ...prev.slice(0, -1)]);
                } else {
                    setTrainings(prev => [response.data, ...prev]);
                    setTotal(total + 1)
                }
            } else {
                setPage(1);
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleOpenChanges = (training) => {
        setSelectedTraining(training)
        setShowChanges(true);
    }

    const handleCloseChanges = () => {
        setShowChanges(false);
        setSelectedTraining(null);
    }

    const handleDownload = async (training) => {
        try {
            const response = await axios.get(`/api/models/${model.id}/trainings/${training.id}?format=zip`, {
                responseType: 'blob',
                headers: {
                    "Authorization": `Bearer ${user.token}`
                }
            });
            const href = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = href;
            link.download = `${model.name}_${training.version}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleOpenTraceback = (training) => {
        setTraceback(training.traceback);
        setShowTraceback(true);
    };

    const handleCloseTraceback = () => {
        setTraceback(null);
        setShowTraceback(false);
    }

    const handleOpenResults = (training) => {
        setResult(training.result[2]);
        setShowResults(true);
    };

    const handleCloseResults = () => {
        setResult(null);
        setShowResults(false);
    }
    
    const handleOpenDeleteConfirmation = (training) => {
        setSelectedTraining(training);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setSelectedTraining(null);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async (trainingId) => {
        try {
            setSubmitting(true);
            setLoading(true);
            const headers = {"Authorization": `Bearer ${user.token}`}
            await axios.delete(`/api/models/${model.id}/trainings/${trainingId}`, {headers});
            if (trainings.length - 1 > 0) {
                if (page === Math.ceil((total) / perPage)) {
                    if (page === 1 && trainingId === currentTraining.id)
                        setCurrentTraining(trainings[1])
                    setTrainings(prev => prev.filter((t) => t.id !== trainingId));
                    setTotal(total - 1);
                } else {
                    let params = { extended: '1', page: page, per_page: perPage };
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${model.id}/trainings`, { params, headers });
                    setTrainings(response.data.trainings);
                    setTotal(response.data.total);
                    if (trainingId === currentTraining.id)
                        setCurrentTraining(response.data.trainings[0]);
                }
            } else {
                if (page > 1) {
                    setPage(page - 1);
                } else {
                    if (trainingId === currentTraining.task_id)
                        setCurrentTraining(null);
                    setTrainings([]);
                    setTotal(0);
                }
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        } finally {
            handleCloseDeleteConfirmation();
            setLoading(false);
            setSubmitting(false);
        }
    };
    
    useEffect(() => {
        pageRef.current = page;
    }, [page]);

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery])

    useEffect(() => {
        if (user && modelId) {
            const getTrainings = async () => {
                try {
                    setLoading(true)
                    let params = {extended: '1', page: page, per_page: perPage};
                    if (debouncedQuery) params.query = debouncedQuery;
                    const headers = {"Authorization": `Bearer ${user.token}`};
                    const response = await axios.get(`/api/models/${modelId}/trainings`, {params, headers});
                    if (response.data.total > 0) {
                        setTrainings(response.data.trainings);
                        setTotal(response.data.total);
                        if (page === 1 && debouncedQuery === '')
                            setCurrentTraining(response.data.trainings[0])
                    }
                    setLoading(false)
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            };
            getTrainings();
        }
    }, [user, modelId, page, perPage, debouncedQuery]);

    useEffect(() => {
        if (user && socket && socket.connected && currentTraining) {
            if (currentTraining.status === 'PENDING' || currentTraining.status === 'RECEIVED' || currentTraining.status === 'STARTED') {
                if (!rooms.current.has(currentTraining.task_id)) {
                    socket.on('status', (data) => {
                        setCurrentTraining(prev => ({...prev, ...data}));
                        setTrainings(prev => prev.map(training => 
                            training.task_id === currentTraining.task_id 
                                ? {...training, ...data} 
                                : training
                        ));
                        if (data.status === 'SUCCESS' || data.status === 'FAILURE') {
                            socket.emit('leave', data.task_id);
                            socket.off('status');
                            rooms.current.delete(data.task_id);
                        }
                    });
                    socket.emit('join', currentTraining.task_id);
                    rooms.current.add(currentTraining.task_id);
                }
            }
        }
    }, [user, socket, currentTraining, page]);

    return (
        <>
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ButtonGroup>
                        <Button
                            variant="light"
                            style={{
                                border: '1px solid #dee2e6'
                            }}
                            onClick={() => setShowParameters(true)}
                        >
                            <Sliders />
                        </Button>
                        {total > 0 ?
                            currentTraining.status === 'PENDING' || currentTraining.status === 'RECEIVED' ?
                                <Button
                                    variant="light"
                                    disabled
                                    style={{
                                        border: '1px solid #dee2e6'
                                    }}
                                >
                                    <Spinner
                                        animation="border"
                                        size="sm"
                                    />
                                    &nbsp;pending...
                                </Button>
                            : currentTraining.status === 'STARTED' ?
                                <Button
                                    variant="light"
                                    disabled
                                    style={{
                                        border: '1px solid #dee2e6'
                                    }}
                                >
                                    <Spinner
                                        animation="grow"
                                        size="sm"
                                    />
                                    &nbsp;training...
                                </Button>
                            : <Button
                                variant="light"
                                    onClick={handleTrain}
                                    style={{
                                        border: '1px solid #dee2e6'
                                    }}
                                >
                                    <ArrowClockwise />&nbsp;start training
                            </Button>
                        : 
                        <Button
                            variant="light"
                                onClick={handleTrain}
                                style={{
                                    border: '1px solid #dee2e6'
                                }}
                            >
                                <ArrowClockwise />&nbsp;start training
                        </Button>}
                    </ButtonGroup>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for trainings..."
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
                                <th>version</th>
                                <th>status</th>
                                <th>date start</th>
                                <th>date done</th>
                                <th>accuracy (%)</th>
                                <th>options</th>
                            </tr>
                        </thead>
                        <tbody>
                        {loading ? (
                            <tr >
                                <td
                                    colSpan={7}
                                    style={{
                                        verticalAlign: 'middle'
                                    }}
                                >
                                    <Spinner animation='border' size='lg'/>
                                </td>
                            </tr>
                        ) : total > 0 ? 
                            trainings.map((training, index) => (
                                <tr key={training.id}>
                                    <td>{(page - 1) * perPage + index + 1}.</td>
                                    <td>{training.version}</td>
                                    <td>{training.status}</td>
                                    <td>{training.created_at}</td>
                                    <td>{training.date_done}</td>
                                    <td>{training.status === 'SUCCESS' && (training.result[1] * 100).toFixed(2)}</td>
                                    <td>
                                        <Dropdown>
                                            <Dropdown.Toggle size='sm' variant='light'>
                                                select
                                            </Dropdown.Toggle>
                                            <Dropdown.Menu>
                                                <Dropdown.Item
                                                    onClick={() => handleOpenChanges(training)}
                                                    disabled={(page - 1) * perPage + index + 1 === 0 || !currentTraining || currentTraining.status === 'PENDING' || currentTraining.status === 'RECEIVED'}
                                                >
                                                    <PlusSlashMinus />
                                                    &nbsp;
                                                    Changes
                                                </Dropdown.Item>
                                                <Dropdown.Item 
                                                    disabled={training.status !== 'SUCCESS'}
                                                    onClick={() => handleDownload(training)}
                                                >
                                                    <Download />
                                                    &nbsp;
                                                    Download
                                                </Dropdown.Item>
                                                <Dropdown.Item 
                                                    disabled={training.status !== 'SUCCESS'}
                                                    onClick={() => handleOpenResults(training)}
                                                >
                                                    <Book />
                                                    &nbsp;
                                                    Report
                                                </Dropdown.Item>
                                                <Dropdown.Item 
                                                    disabled={training.status !== 'FAILURE'}
                                                    onClick={() => handleOpenTraceback(training)}
                                                >
                                                    <Bug />
                                                    &nbsp;
                                                    Traceback
                                                </Dropdown.Item>
                                                <Dropdown.Divider />
                                                <Dropdown.Item 
                                                    disabled={training.status !== 'SUCCESS' && training.status !== 'FAILURE'}
                                                    onClick={() => handleOpenDeleteConfirmation(training)}
                                                >
                                                    <Trash />
                                                    &nbsp;
                                                    Delete
                                                </Dropdown.Item>
                                            </Dropdown.Menu>
                                        </Dropdown>
                                    </td>
                                </tr>
                            )) : query !== '' ? (
                                <tr>
                                    <td
                                        colSpan={7}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <i class="bi bi-ban" />&nbsp;could not find the training you are looking for.
                                    </td>
                                </tr>
                            ) : (
                                <tr>
                                    <td
                                        colSpan={7}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <InfoCircle />&nbsp;looks like you have no trainings.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                    <br></br>
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
                    </Pagination>}
                </Col>
            </Row>
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
                                    <option value='accuracy'>
                                        accuracy
                                    </option>
                                    <option value='loss'>
                                        loss
                                    </option>
                                    <option value='val_accuracy'>
                                        validation accuracy
                                    </option>
                                    <option value='val_loss' selected>
                                        validation loss
                                    </option>
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
            <Modal centered fullscreen={true} show={showChanges} onHide={handleCloseChanges}>
                <Modal.Header closeButton>
                    <Modal.Title>Changes&nbsp;<QuestionCircle /></Modal.Title>
                </Modal.Header>
                <Modal.Body
                    style={{
                        overflowY: 'scroll'
                    }}
                >
                    {selectedTraining && currentTraining && <ReactDiffViewer 
                        oldValue={selectedTraining.args[0].map((item, index) => `${item}\t${selectedTraining.args[1][index]}`).join('\n')}
                        leftTitle={`${selectedTraining.version} (SELECTED)`}
                        newValue={currentTraining.args[0].map((item, index) => `${item}\t${currentTraining.args[1][index]}`).join('\n')}
                        rightTitle={`${currentTraining.version} (LATEST)`}
                        splitView={true}
                        showDiffOnly={true}
                        hideLineNumbers={false}
                    />}
                </Modal.Body>
            </Modal>
            <Modal centered show={showResults} onHide={handleCloseResults}>
                <Modal.Header closeButton>
                    <Modal.Title>Classification Report</Modal.Title>
                </Modal.Header>
                <Modal.Body
                    style={{
                        maxHeight: '75vh',
                        overflowY: 'scroll'
                    }}
                >
                    <div className="d-flex justify-content-center align-items-center">
                        <pre>
                            {result}
                        </pre>
                    </div>
                </Modal.Body>
            </Modal>
            <Modal size="lg" centered show={showTraceback} onHide={handleCloseTraceback}>
                <Modal.Header closeButton>
                    <Modal.Title>Traceback</Modal.Title>
                </Modal.Header>
                <Modal.Body
                    style={{
                        maxHeight: '50vh',
                        overflowY: 'scroll'
                    }}
                >
                    <div className="d-flex justify-content-center align-items-center">
                        <pre>
                            {traceback}
                        </pre>    
                    </div>
                </Modal.Body>
            </Modal>
            <Modal centered show={showDeleteConfirmation} onHide={handleCloseDeleteConfirmation}>
                <Modal.Header closeButton>
                    <Modal.Title>Delete training</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>Are you sure you want to delete the training?</p>
                    <Button
                        type="submit"
                        variant="danger"
                        disabled={submitting}
                        onClick={() => handleDelete(selectedTraining.id)}
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

export default History;