import { useContext, useEffect, useState } from "react";
import { Alert, Col, Nav, Row, Spinner } from "react-bootstrap";
import { Activity, Broadcast, Database, GraphUp, Grid1x2 } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import axios from "axios";
import { UserContext } from "../../../../contexts/UserContext";
import { ModelContext } from "../../../../contexts/ModelContext";
import Overview from "./components/Overview";
import Dataset from "./components/Dataset";
import Versions from "./components/Versions";
import Traffic from "./components/Traffic";

const TABS = [
    ["overview", "Overview", <Grid1x2 key="overview" />],
    ["dataset", "Dataset", <Database key="dataset" />],
    ["model", "Model", <GraphUp key="model" />],
    ["live", "Live", <Broadcast key="live" />]
];

// The Analyse surface: read-only analytics over the dataset, the trained
// versions and the live production traffic, branching on the model type —
// classification reads labels/utterances, named entity recognition reads
// entities/spans. All aggregation happens server-side in the analytics API.
const Analyse = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);

    const [tab, setTab] = useState("overview");
    const [win, setWin] = useState(5);
    const [dataset, setDataset] = useState(null);
    const [versions, setVersions] = useState([]);
    const [best, setBest] = useState(null);
    const [confusions, setConfusions] = useState(null);
    const [instances, setInstances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user || !modelId) return;
        const headers = { Authorization: `Bearer ${user.token}` };
        const load = async () => {
            try {
                setLoading(true);
                const [datasetRes, versionsRes, instancesRes] = await Promise.all([
                    axios.get(`/api/models/${modelId}/analytics/dataset`, { headers }),
                    axios.get(`/api/models/${modelId}/analytics/versions`, { headers }),
                    axios.get(`/api/models/${modelId}/instances`, { headers })
                ]);
                setDataset(datasetRes.data);
                setVersions(versionsRes.data.versions || []);
                setBest(versionsRes.data.best || null);
                setInstances(instancesRes.data.instances || []);
                setError(null);
            } catch (err) {
                setError(err.response?.data?.error || err.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [user, modelId]);

    useEffect(() => {
        if (!user || !modelId) return;
        const loadConfusions = async () => {
            try {
                const response = await axios.get(`/api/models/${modelId}/analytics/confusions`, {
                    params: { window: win },
                    headers: { Authorization: `Bearer ${user.token}` }
                });
                setConfusions(response.data);
            } catch (err) {
                console.error(err.response?.data?.error || err.message);
            }
        };
        loadConfusions();
    }, [user, modelId, win]);

    const ner = (model?.type || dataset?.type) === "named_entity_recognition";

    return (
        <Row className="mt-4 pb-5">
            <Col>
                <Nav
                    variant="pills"
                    activeKey={tab}
                    onSelect={(key) => setTab(key)}
                    className="gap-1 mb-4 flex-nowrap overflow-auto"
                >
                    {TABS.map(([key, title, icon]) => (
                        <Nav.Item key={key}>
                            <Nav.Link eventKey={key} className="d-inline-flex align-items-center gap-2 small text-nowrap">
                                {icon}{title}
                            </Nav.Link>
                        </Nav.Item>
                    ))}
                </Nav>
                {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
                {loading ? (
                    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "40vh" }}>
                        <Spinner animation="border" variant="secondary" />
                    </div>
                ) : (
                    <>
                        {tab === "overview" && (
                            <Overview
                                dataset={dataset}
                                versions={versions}
                                best={best}
                                instances={instances}
                                ner={ner}
                                goto={setTab}
                            />
                        )}
                        {tab === "dataset" && <Dataset dataset={dataset} versions={versions} ner={ner} />}
                        {tab === "model" && (
                            <Versions
                                versions={versions}
                                best={best}
                                confusions={confusions}
                                win={win}
                                setWin={setWin}
                                ner={ner}
                            />
                        )}
                        {tab === "live" && <Traffic dataset={dataset} instances={instances} ner={ner} />}
                    </>
                )}
                {!loading && !error && tab !== "live" && !versions.length && !dataset?.totals?.utterances && (
                    <div className="text-center text-muted small mt-4">
                        <Activity className="me-1" />
                        Analytics fills in as you author data in Build and train versions in History.
                    </div>
                )}
            </Col>
        </Row>
    );
};

export default Analyse;
