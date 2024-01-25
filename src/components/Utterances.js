import { useContext, useEffect, useState } from "react";
import { Alert, Col, Row, Form, ListGroup, Pagination } from "react-bootstrap";
import { Trash } from "react-bootstrap-icons";
import { UserContext } from "../contexts/UserContext";
import axios from "axios";
import { useParams } from "react-router-dom";


const Utterances = () => {

    const { modelId, labelId } = useParams();

    const { user } = useContext(UserContext)

    const [alert, setAlert] = useState(null);
    const [utterance, setUtterance] = useState('');
    const [utterances, setUtterances] = useState([]);
    const [filter, setFilter] = useState([]);
    const [data, setData] = useState([]);
    const [page, setPage] = useState(1);

    const itemsPerPage = 10;
    const maxVisiblePages = 5;

    useEffect(() => {
        if (user && modelId && labelId) {
            const getUtterances = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}/labels/${labelId}/utterances`,
                        {
                            headers: {
                                "Authorization": `Bearer ${user.token}`
                            }
                        }
                    )
                    setUtterances(response.data.utterances);
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            };
            getUtterances();
        }
    }, [user, modelId, labelId])

    useEffect(() => {
        if (utterance !== '') {
            setFilter(utterances.filter((i) => i.text.toLowerCase().includes(utterance.toLowerCase())));
        } else {
            setFilter(utterances);
        }
    }, [utterances, utterance])

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
                            placeholder="enter an utterance..."
                            value={utterance}
                            onChange={(e) => setUtterance(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ListGroup variant="flush">
                        {data.map((value) => (
                            <ListGroup.Item className="d-flex justify-content-between align-items-start">
                                <div className="me-auto">
                                    {value.text}
                                </div>
                                <div>
                                    <Trash />
                                </div>
                            </ListGroup.Item>
                        ))}
                    </ListGroup>
                    <br/>
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
        </>
    );
}

export default Utterances;