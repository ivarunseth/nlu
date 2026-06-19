import { useContext, useEffect, useState } from "react";
import { Alert, Col, Row, Form, ListGroup, Spinner, Pagination } from "react-bootstrap";
import { Trash, InfoCircle } from "react-bootstrap-icons";
import { UserContext } from "../contexts/UserContext";
import axios from "axios";
import { useParams } from "react-router-dom";
import useDebounce from "../useDebounce";


const Utterances = () => {

    const { modelId, labelId } = useParams();

    const { user } = useContext(UserContext)

    const [alert, setAlert] = useState(null);
    const [query, setQuery] = useState('');
    const [utterances, setUtterances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const perPage = 10;
    const maxVisiblePages = 5;

    let debouncedQuery = useDebounce(query, 500);

    const handleCreate = async (query) => {
        if (query.trim() !== '') {
            try {
                // setLoading(true)
                let data = {text: query.trim()};
                const headers = {"Authorization": `Bearer ${user.token}`}
                const response = await axios.post(`/api/models/${modelId}/labels/${labelId}/utterances`, data, {headers});
                if (page === 1) {
                    if (total + 1 > perPage) {
                        setUtterances([response.data, ...utterances.slice(0, -1)]);
                    } else {
                        setUtterances([response.data, ...utterances]);
                    }
                } else {
                    setPage(1);
                }
                // setLoading(false)
                setQuery('');
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            }
        }
    };

    const handleEdit = async (utteranceId, utteranceText) => {
        if (utteranceId && utteranceText !== '') {
            const originalText = utterances.filter((utterance) => utterance.id === utteranceId)[0].text;
            if (utteranceText !== originalText) {
                try {
                    await axios.put(
                        `/api/models/${modelId}/labels/${labelId}/utterances/${utteranceId}`,
                        { text: utteranceText },
                        {
                            headers: {
                                Authorization: `Bearer ${user.token}`,
                            },
                        }
                    );
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            }
        }
    };

    const handleDelete = async (utteranceId) => {
        try {
            const headers = {"Authorization": `Bearer ${user.token}`}
            await axios.delete(
                `/api/models/${modelId}/labels/${labelId}/utterances/${utteranceId}`, 
                { headers }
            );
            if (utterances.length - 1 > 0) {
                setLoading(true);
                if (page === Math.ceil((total) / perPage)) {
                    setUtterances(prevUtterances => prevUtterances.filter((u) => u.id !== utteranceId));
                    setTotal(total - 1);
                } else {
                    let params = { page: page, per_page: perPage };
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery;
                    const response = await axios.get(
                        `/api/models/${modelId}/labels/${labelId}/utterances`, 
                        { params, headers }
                    );
                    setUtterances(response.data.utterances);
                    setTotal(response.data.total);
                }
                setLoading(false);
            } else {
                if (page > 1) {
                    setPage(page - 1);
                } else {
                    setUtterances([]);
                    setTotal(0);
                }
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    useEffect(() => {            
        if (user && modelId && labelId) {
            const getUtterances = async () => {
                setLoading(true);
                try {
                    let params = {page: page, per_page: perPage}
                    if (debouncedQuery !== '') {
                        params.query = debouncedQuery
                    }
                    const headers = {"Authorization": `Bearer ${user.token}`}
                    const response = await axios.get(`/api/models/${modelId}/labels/${labelId}/utterances`, {params, headers});
                    setUtterances(response.data.utterances);
                    setTotal(response.data.total);
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                } finally {
                    setLoading(false);
                }
            };
            getUtterances();
        }
    }, [user, modelId, labelId, page, perPage, debouncedQuery]);

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
                            placeholder="enter or search an utterance..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleCreate(e.target.value);
                                }
                            }}
                        />
                    </Form>
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ListGroup>
                        {loading ? (
                            <ListGroup.Item 
                                className="d-flex justify-content-center align-items-center"
                                style={{
                                    minHeight: '50vh'
                                }}
                            >
                                <Spinner animation='border' size='lg'/>
                            </ListGroup.Item>
                        ) : total > 0 ? utterances.map((utterance, index) => (
                            <ListGroup.Item 
                                key={utterance.id}
                                className="d-flex justify-content-between align-items-start"
                            >
                                <div className="me-1">
                                    {(page - 1) * perPage + index + 1}.
                                </div>
                                <div 
                                    className="me-auto px-1"
                                    contentEditable
                                    suppressContentEditableWarning
                                    dangerouslySetInnerHTML={{ __html: utterance.text }}
                                    onBlur={(e) => handleEdit(utterance.id, e.currentTarget.textContent)}
                                />
                                <div className="ms-1">
                                    <Trash 
                                        onClick={() => handleDelete(utterance.id)}
                                        style={{
                                            cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            </ListGroup.Item>
                        )) : query !== '' ? (
                            <ListGroup.Item 
                                className="d-flex justify-content-center align-items-center"
                                style={{
                                    minHeight: '50vh'
                                }}
                            >
                                <i class="bi bi-ban" />&nbsp;could not find the model you are looking for.
                            </ListGroup.Item>
                        ) : (
                            <ListGroup.Item 
                                className="d-flex justify-content-center align-items-center"
                                style={{
                                    minHeight: '50vh'
                                }}
                            >
                                <InfoCircle />&nbsp;looks like you have no utterances.
                            </ListGroup.Item>
                        )}
                    </ListGroup>
                    <br/>
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
        </>
    );
}

export default Utterances;