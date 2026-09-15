import { useApi } from "../../../../contexts/ApiContext";
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
    const api = useApi();
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
            const created = await api.intents.createUtterance(modelId, labelId, { text });

            if (page === 1) {
                setUtterances((prevUtterances) => (
                    total + 1 > PER_PAGE
                        ? [created, ...prevUtterances.slice(0, -1)]
                        : [created, ...prevUtterances]
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
            await api.intents.updateUtterance(modelId, labelId, utteranceId, { text: utteranceText });
        } catch (error) {
            setAlert({ variant: "danger", message: error.response.data.error });
        }
    };

    const handleDelete = async (utteranceId) => {
        try {
            await api.intents.removeUtterance(modelId, labelId, utteranceId);

            if (utterances.length - 1 > 0) {
                if (page === Math.ceil(total / PER_PAGE)) {
                    setUtterances((prevUtterances) => prevUtterances.filter((u) => u.id !== utteranceId));
                    setTotal((prevTotal) => prevTotal - 1);
                } else {
                    setLoading(true);
                    const params = { page, per_page: PER_PAGE };
                    if (debouncedQuery !== "") params.query = debouncedQuery;
                    const { utterances: rows, total: count } = await api.intents.listUtterances(modelId, labelId, params);
                    setUtterances(rows);
                    setTotal(count);
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
                    const { utterances: rows, total: count } = await api.intents.listUtterances(modelId, labelId, params);
                    setUtterances(rows);
                    setTotal(count);
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
                    <div className="mt-3">
                        <AppPagination
                            page={page}
                            total={total}
                            perPage={PER_PAGE}
                            maxVisiblePages={MAX_VISIBLE_PAGES}
                            onPageChange={setPage}
                        />
                    </div>
                </Col>
            </Row>
        </>
    );
};

export default Utterances;
