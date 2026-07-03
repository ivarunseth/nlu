import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Container, Row, Col, Nav } from 'react-bootstrap';
import { Translate, ClockHistory, ClipboardCheck, RocketTakeoff, Activity } from 'react-bootstrap-icons';
import { Routes, Route, Link, useLocation, useParams } from 'react-router-dom';
import { SocketProvider } from '../../contexts/SocketContext';
import { ModelContext, ModelProvider } from '../../contexts/ModelContext';
import { UserContext } from '../../contexts/UserContext';
import axios from 'axios';

const Build = lazy(() => import('./routes/build/Build'));
const Utterances = lazy(() => import('./routes/utterances/Utterances'));
const History = lazy(() => import('./routes/history/History'));
const Test = lazy(() => import('./routes/test/Test'));
const Publish = lazy(() => import('./routes/publish/Publish'));
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
    const [labelName, setLabelName] = useState('');
    const [trainingVersion, setTrainingVersion] = useState('');

    useEffect(() => {
        if (user && modelId && labelId) {
            const getLabel = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}/labels/${labelId}`,
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
    }, [user, modelId, labelId]);

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
                        {labelId || trainingId ? (
                            <>
                                <Link to={`${modelBasePath}/${activeSection}`} className='text-decoration-none'>
                                    {activeSection}
                                </Link>
                                <span className='text-muted px-1'>/</span>
                                <span className='text-body'>
                                    {labelName || trainingVersion || '...'}
                                </span>
                            </>
                        ) : (
                            <span className='text-body'>
                                {activeSection}
                            </span>
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
