import axios from "axios";
import { useContext, useEffect, useState } from "react";
import { Alert, Col, Form, Row } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { UserContext } from "../../../../contexts/UserContext";
import AppPagination from "../../../../shared/components/AppPagination";
import useDebounce from "../../../../shared/hooks/useDebounce";
import UtteranceList from "./components/UtteranceList";

const PER_PAGE = 10;
const MAX_VISIBLE_PAGES = 5;

const Utterances = () => {
    const { modelId, labelId } = useParams();
    const { user } = useContext(UserContext);
    const [alert, setAlert] = useState(null);
    const [query, setQuery] = useState("");
    const [utterances, setUtterances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const debouncedQuery = useDebounce(query, 500);

    const handleCreate = async (value) => {
        const text = value.trim();
        if (text === "") return;

        try {
            const data = { text };
            const headers = { Authorization: `Bearer ${user.token}` };
            const response = await axios.post(`/api/models/${modelId}/labels/${labelId}/utterances`, data, { headers });

            if (page === 1) {
                setUtterances((prevUtterances) => (
                    total + 1 > PER_PAGE
                        ? [response.data, ...prevUtterances.slice(0, -1)]
                        : [response.data, ...prevUtterances]
                ));
                setTotal((prevTotal) => prevTotal + 1);
            } else {
                setPage(1);
            }
            setQuery("");
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    const handleEdit = async (utteranceId, utteranceText) => {
        if (!utteranceId || utteranceText === "") return;

        const originalText = utterances.find((utterance) => utterance.id === utteranceId)?.text;
        if (utteranceText === originalText) return;

        try {
            await axios.put(
                `/api/models/${modelId}/labels/${labelId}/utterances/${utteranceId}`,
                { text: utteranceText },
                {
                    headers: {
                        Authorization: `Bearer ${user.token}`
                    }
                }
            );
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    const handleDelete = async (utteranceId) => {
        try {
            const headers = { Authorization: `Bearer ${user.token}` };
            await axios.delete(
                `/api/models/${modelId}/labels/${labelId}/utterances/${utteranceId}`,
                { headers }
            );

            if (utterances.length - 1 > 0) {
                if (page === Math.ceil(total / PER_PAGE)) {
                    setUtterances((prevUtterances) => prevUtterances.filter((u) => u.id !== utteranceId));
                    setTotal((prevTotal) => prevTotal - 1);
                } else {
                    setLoading(true);
                    const params = { page, per_page: PER_PAGE };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const response = await axios.get(
                        `/api/models/${modelId}/labels/${labelId}/utterances`,
                        { params, headers }
                    );
                    setUtterances(response.data.utterances);
                    setTotal(response.data.total);
                }
            } else if (page > 1) {
                setPage(page - 1);
            } else {
                setUtterances([]);
                setTotal(0);
            }
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        } finally {
            setLoading(false);
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
                    const params = { page, per_page: PER_PAGE };
                    if (debouncedQuery !== "") {
                        params.query = debouncedQuery;
                    }
                    const headers = { Authorization: `Bearer ${user.token}` };
                    const response = await axios.get(`/api/models/${modelId}/labels/${labelId}/utterances`, { params, headers });
                    setUtterances(response.data.utterances);
                    setTotal(response.data.total);
                } catch (error) {
                    setAlert({ variant: "danger", message: error.response.data.error });
                } finally {
                    setLoading(false);
                }
            };
            getUtterances();
        }
    }, [user, modelId, labelId, page, debouncedQuery]);

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
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
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
                    <UtteranceList
                        loading={loading}
                        utterances={utterances}
                        total={total}
                        query={query}
                        page={page}
                        perPage={PER_PAGE}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                    <br />
                    <AppPagination
                        page={page}
                        total={total}
                        perPage={PER_PAGE}
                        maxVisiblePages={MAX_VISIBLE_PAGES}
                        onPageChange={setPage}
                    />
                </Col>
            </Row>
        </>
    );
};

export default Utterances;
