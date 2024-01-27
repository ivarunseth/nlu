import { useContext, useEffect, useState } from "react";
import { Alert, Button, Col, Row, Form, Spinner, Table, Dropdown, Pagination, Modal } from "react-bootstrap";
import { InfoCircle, Download, PlusSlashMinus, Book, Bug, Trash } from "react-bootstrap-icons";
import { UserContext } from "../contexts/UserContext";
import { ModelContext } from "../contexts/ModelContext";
import axios from "axios";

const History = () => {

    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);

    const [search, setSearch] = useState('');
    const [alert, setAlert] = useState(null);
    const [trainings, setTrainings] = useState([]);
    const [filter, setFilter] = useState([]);
    const [data, setData] = useState([]);
    const [result, setResult] = useState(null)
    const [showResults, setShowResults] = useState(false);
    const [traceback, setTraceback] = useState(null);
    const [showTraceback, setShowTraceback] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [currentTraining, setCurrentTraining] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;

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
        setCurrentTraining(training);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setCurrentTraining(null);
        setSubmitting(false);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const response = await axios.delete(
                `/api/models/${model.id}/trainings/${currentTraining.id}`,
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setTrainings(response.data.trainings)
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        } finally {
            handleCloseDeleteConfirmation();
        }
    };

    useEffect(() => {
        if (user && model) {
            const getTrainings = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${model.id}/trainings`,
                        {
                            headers: {
                                "Authorization": `Bearer ${user.token}`
                            }
                        }
                    );
                    setTrainings(response.data.trainings)
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            };
            getTrainings();
        }
    }, [user, model]);

    useEffect(() => {
        if (search !== '') {
            setFilter(trainings.filter((training) => training.version.toLowerCase().includes(search.toLowerCase())));
        } else {
            setFilter(trainings);
        }
    }, [trainings, search])

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
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for trainings..."
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
                                <th>version</th>
                                <th>status</th>
                                <th>date start</th>
                                <th>date done</th>
                                <th>accuracy (%)</th>
                                <th>options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trainings.length > 0 ? search !== '' && filter.length === 0 ? (
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
                            ) : data.map((training, index) => (
                                <tr key={training.id}>
                                    <td>{(page - 1) * itemsPerPage + index + 1}.</td>
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
                                                <Dropdown.Item>
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
                            )) : (
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
            <Modal centered show={showResults} onHide={handleCloseResults}>
                <Modal.Header closeButton>
                    <Modal.Title>Classification Report</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <pre>
                        {result}
                    </pre>
                </Modal.Body>
            </Modal>
            <Modal size="lg" centered show={showTraceback} onHide={handleCloseTraceback}>
                <Modal.Header closeButton>
                    <Modal.Title>Traceback</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <pre>
                        {traceback}
                    </pre>
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

export default History;