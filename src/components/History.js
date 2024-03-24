import { useContext, useEffect, useState } from "react";
import { Alert, Button, Col, Row, Form, Spinner, Table, Dropdown, Pagination, Modal, Nav } from "react-bootstrap";
import { InfoCircle, Download, PlusSlashMinus, Book, Bug, Trash, QuestionCircle } from "react-bootstrap-icons";
import ReactDiffViewer from 'react-diff-viewer';
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
    const [showChanges, setShowChanges] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [reportEventKey, setReportEventKey] = useState(1);
    const [showTraceback, setShowTraceback] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [selectedTraining, setSelectedTraining] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [page, setPage] = useState(1);
    const itemsPerPage = 7;
    const maxVisiblePages = 5;

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
        setSelectedTraining(training);
        setShowTraceback(true);
    };

    const handleCloseTraceback = () => {
        setShowTraceback(false);
        setSelectedTraining(null);
    }
    
    const handleOpenReport = (training) => {
        setSelectedTraining(training);
        setShowReport(true);
    };

    const handleCloseResults = () => {
        setShowReport(false);
        setSelectedTraining(null);
    }
    
    const handleOpenDeleteConfirmation = (training) => {
        setSelectedTraining(training);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setSubmitting(false);
        setShowDeleteConfirmation(false);
        setSelectedTraining(null);
    }

    const handleDelete = async () => {
        try {
            setSubmitting(true);
            const response = await axios.delete(
                `/api/models/${model.id}/trainings/${selectedTraining.id}`,
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
                                <th>train/test accuracy (%)</th>
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
                                    <td>{training.status === 'SUCCESS' && `${(training.result[2] * 100).toFixed(2)} / ${(training.result[5] * 100).toFixed(2)}`}</td>
                                    <td>
                                        <Dropdown>
                                            <Dropdown.Toggle size='sm' variant='light'>
                                                select
                                            </Dropdown.Toggle>
                                            <Dropdown.Menu>
                                                <Dropdown.Item
                                                    onClick={() => handleOpenChanges(training)}
                                                    disabled={(page - 1) * itemsPerPage + index + 1 === 0}
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
                                                    onClick={() => handleOpenReport(training)}
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
            <Modal size='lg' centered show={showChanges} onHide={handleCloseChanges}>
                <Modal.Header closeButton>
                    <Modal.Title>Changes&nbsp;<QuestionCircle /></Modal.Title>
                </Modal.Header>
                <Modal.Body
                    style={{
                        maxHeight: '75vh',
                        overflowY: 'scroll'
                    }}
                >
                    {selectedTraining && <ReactDiffViewer 
                        oldValue={selectedTraining.args[0].map((item, index) => `${item}, ${selectedTraining.args[1][index]}`).join('\n')}
                        leftTitle={`${selectedTraining.version} (SELECTED)`}
                        newValue={trainings[0].args[0].map((item, index) => `${item}, ${trainings[0].args[1][index]}`).join('\n')}
                        rightTitle={`${trainings[0].version} (LATEST)`}
                        splitView={true}
                        showDiffOnly={true}
                        hideLineNumbers={true}
                    />}
                </Modal.Body>
            </Modal>
            <Modal size="lg" centered show={showReport} onHide={handleCloseResults}>
                <Modal.Header closeButton>
                    <Modal.Title>Classification Report&nbsp;<QuestionCircle /></Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {selectedTraining &&
                    <>
                        <Row>
                            <Col>
                                <Nav fill variant="underline" defaultActiveKey={reportEventKey}>
                                    <Nav.Item onClick={() => setReportEventKey(1)}>
                                        <Nav.Link eventKey={1}>
                                            Training
                                        </Nav.Link>
                                    </Nav.Item>
                                    <Nav.Item onClick={() => setReportEventKey(2)}>
                                        <Nav.Link eventKey={2}>
                                            Testing
                                        </Nav.Link>
                                    </Nav.Item>
                                </Nav>
                            </Col>
                        </Row>
                        <Row
                            style={{
                                maxHeight: '50vh',
                                overflowY: 'scroll'
                            }}>
                            <div className="d-flex justify-content-center align-items-center mt-4">
                                <pre>
                                    {reportEventKey === 1 ? selectedTraining.result[3] : reportEventKey === 2 ? selectedTraining.result[6] : null}
                                </pre>
                            </div>
                        </Row>
                    </>}
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
                        {selectedTraining && <pre>{selectedTraining.traceback}</pre>}
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