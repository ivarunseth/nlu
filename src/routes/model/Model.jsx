import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Container, Row, Col, Nav } from 'react-bootstrap';
import { Translate, ClockHistory, ClipboardCheck, RocketTakeoff, Activity } from 'react-bootstrap-icons';
import { Routes, Route, Link, useLocation, useParams } from 'react-router-dom';
import { SocketProvider } from '../../contexts/SocketContext';
import { ModelContext, ModelProvider } from '../../contexts/ModelContext';
import { UserContext } from '../../contexts/UserContext';
import axios from 'axios';

const Build = lazy(() => import('./routes/studio/Build'));
const Utterances = lazy(() => import('./routes/utterances/Utterances'));
const History = lazy(() => import('./routes/history/History'));
const Test = lazy(() => import('./routes/test/Test'));
const Publish = lazy(() => import('./routes/publish/Publish'));
const Analyse = lazy(() => import('./routes/analyse/Analyse'));
const TrainingVersion = lazy(() => import('./routes/history/History').then((module) => ({
    default: module.TrainingVersion
})));

const ModelContent = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const location = useLocation();
    const modelBasePath = `/models/${modelId}`;
    const pathParts = location.pathname.split('/').filter(Boolean);
    const activeSection = pathParts[2] || 'build';
    const labelId = pathParts.includes('utterances') ? pathParts[3] : null;
    const trainingId = pathParts[2] === 'history' && pathParts[3] ? pathParts[3] : null;
    // A language understanding Build drill-in lives in a search param, not the
    // path (?intent= / ?entity=), so surface it in this one page breadcrumb.
    const searchParams = new URLSearchParams(location.search);
    const intentId = activeSection === 'build' ? searchParams.get('intent') : null;
    const entityId = activeSection === 'build' ? searchParams.get('entity') : null;
    // Entity drill-ins resolve their name via the entity registry; every
    // other detail (a classification label or an intent) is an intent row.
    const detailLabelId = labelId || intentId || entityId;
    const detailResource = !labelId && !intentId && entityId ? 'entities' : 'intents';
    // A language understanding Build breadcrumb names the active registry as a
    // plain-text suffix: build / intents (or entities), and on a drill-in
    // build / intents / <name> — `build` is the only link, and it carries the
    // tab so walking back out lands on the same registry.
    const buildTab = activeSection === 'build' && model?.kind === 'natural_language_understanding'
        ? (entityId || searchParams.get('tab') === 'entities' ? 'entities' : 'intents')
        : null;
    const detailParentLink = buildTab
        ? `${modelBasePath}/build?tab=${buildTab}`
        : `${modelBasePath}/${activeSection}`;
    const [labelName, setLabelName] = useState('');
    const [trainingVersion, setTrainingVersion] = useState('');

    useEffect(() => {
        if (user && modelId && detailLabelId) {
            const getLabel = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}/${detailResource}/${detailLabelId}`,
                        {
                            headers: {
                                Authorization: `Bearer ${user.token}`,
                            },
                        }
                    );
                    setLabelName(response.data.name);
                } catch (error) {
                    setLabelName('');
                    console.error(error.response?.data?.error || error.message);
                }
            };
            getLabel();
        } else {
            setLabelName('');
        }
    }, [user, modelId, detailResource, detailLabelId]);

    useEffect(() => {
        if (user && modelId && trainingId) {
            const getTraining = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}/trainings/${trainingId}`,
                        {
                            headers: {
                                Authorization: `Bearer ${user.token}`,
                            },
                        }
                    );
                    setTrainingVersion(response.data.version);
                } catch (error) {
                    setTrainingVersion('');
                    console.error(error.response?.data?.error || error.message);
                }
            };
            getTraining();
        } else {
            setTrainingVersion('');
        }
    }, [user, modelId, trainingId]);

    return (
        <>
            <Row className='page-context-bar align-items-center gx-3 row-gap-2'>
                <Col xs={12} md={4} xl={5} className='d-flex align-items-center'>
                    <nav
                        aria-label='breadcrumb'
                        className='d-flex align-items-center flex-wrap gap-1 lh-sm'
                        style={{ minHeight: '42px' }}
                    >
                        <Link to='/' className='text-decoration-none'>
                            models
                        </Link>
                        <span className='text-muted px-1'>/</span>
                        <span className='text-body'>
                            {model?.name || '...'}
                        </span>
                        <span className='text-muted px-1'>/</span>
                        {detailLabelId || trainingId ? (
                            <>
                                <Link to={detailParentLink} className='text-decoration-none'>
                                    {activeSection}
                                </Link>
                                <span className='text-muted px-1'>/</span>
                                {buildTab && (
                                    <>
                                        <span className='text-body'>
                                            {buildTab}
                                        </span>
                                        <span className='text-muted px-1'>/</span>
                                    </>
                                )}
                                <span className='text-body'>
                                    {labelName || trainingVersion || '...'}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className='text-body'>
                                    {activeSection}
                                </span>
                                {buildTab && (
                                    <>
                                        <span className='text-muted px-1'>/</span>
                                        <span className='text-body'>
                                            {buildTab}
                                        </span>
                                    </>
                                )}
                            </>
                        )}
                    </nav>
                </Col>
                <Col xs={12} md={8} xl={7} className='d-flex align-items-center'>
                    <Nav
                        fill
                        variant='underline'
                        activeKey={activeSection}
                        className='justify-content-md-end flex-nowrap overflow-auto w-100'
                    >
                        <Nav.Item>
                            <Nav.Link
                                eventKey='build'
                                as={Link}
                                to={`${modelBasePath}/build`}
                            >
                                <Translate />&nbsp;Build
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='history'
                                as={Link}
                                to={`${modelBasePath}/history`}
                            >
                                <ClockHistory />&nbsp;History
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='test'
                                as={Link}
                                to={`${modelBasePath}/test`}
                            >
                                <ClipboardCheck />&nbsp;Test
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='publish'
                                as={Link}
                                to={`${modelBasePath}/publish`}
                            >
                                <RocketTakeoff />&nbsp;Publish
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='analyse'
                                as={Link}
                                to={`${modelBasePath}/analyse`}
                            >
                                <Activity />&nbsp;Analyse
                            </Nav.Link>
                        </Nav.Item>
                    </Nav>
                </Col>
            </Row>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="build" element={<Build />} />
                    <Route path="history" element={<History />} />
                    <Route path="history/:trainingId" element={<TrainingVersion />} />
                    <Route path="test" element={<Test />} />
                    <Route path="publish" element={<Publish />} />
                    <Route path="analyse" element={<Analyse />} />
                    <Route path="build/:labelId/utterances" element={<Utterances />} />
                </Routes>
            </Suspense>
        </>
    );
}

const Model = () => {

    return (
        <Container fluid>
            <ModelProvider>
                <SocketProvider>
                    <ModelContent />
                </SocketProvider>
            </ModelProvider>
        </Container>
    );
}

export default Model;
