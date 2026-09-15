import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Row, Col, Nav, Navbar } from 'react-bootstrap';
import { Translate, ClockHistory, ClipboardCheck, RocketTakeoff, Activity, Gear } from 'react-bootstrap-icons';
import { Routes, Route, Link, useLocation, useParams } from 'react-router-dom';
import { SocketProvider } from '../../contexts/SocketContext';
import { ModelContext, ModelProvider } from '../../contexts/ModelContext';
import RouteFallback from '../../shared/components/RouteFallback';
import RouteErrorBoundary from '../../shared/components/RouteErrorBoundary';
import PageShell from '../../shared/components/PageShell';
import { UserContext } from '../../contexts/UserContext';
import { useApi } from '../../contexts/ApiContext';

const Build = lazy(() => import('./routes/studio/Build'));
const Utterances = lazy(() => import('./routes/utterances/Utterances'));
const History = lazy(() => import('./routes/history/History'));
const Test = lazy(() => import('./routes/test/Test'));
const Publish = lazy(() => import('./routes/publish/Publish'));
const Analyse = lazy(() => import('./routes/analyse/Analyse'));
const Settings = lazy(() => import('./routes/settings/Settings'));
const TrainingVersion = lazy(() => import('./routes/history/History').then((module) => ({
    default: module.TrainingVersion
})));

// Crumbs derived from route params arrive lower case; the rest of the
// navigation is Title Case, so bring them onto the same convention.
const capitalise = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

const SECTIONS = {
    build: { icon: <Translate />, label: 'Build' },
    history: { icon: <ClockHistory />, label: 'History' },
    test: { icon: <ClipboardCheck />, label: 'Test' },
    publish: { icon: <RocketTakeoff />, label: 'Publish' },
    analyse: { icon: <Activity />, label: 'Analyse' },
    settings: { icon: <Gear />, label: 'Settings' },
};

const ModelContent = () => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const api = useApi();
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
                    const resource = detailResource === 'entities' ? api.entities : api.intents;
                    const { name } = await resource.get(modelId, detailLabelId);
                    setLabelName(name);
                } catch (error) {
                    setLabelName('');
                    console.error(error.response?.data?.error || error.message);
                }
            };
            getLabel();
        } else {
            setLabelName('');
        }
    }, [api, user, modelId, detailResource, detailLabelId]);

    useEffect(() => {
        if (user && modelId && trainingId) {
            const getTraining = async () => {
                try {
                    const { version } = await api.trainings.get(modelId, trainingId);
                    setTrainingVersion(version);
                } catch (error) {
                    setTrainingVersion('');
                    console.error(error.response?.data?.error || error.message);
                }
            };
            getTraining();
        } else {
            setTrainingVersion('');
        }
    }, [api, user, modelId, trainingId]);

    return (
        <PageShell contextBar={(
            <Row className='page-context-bar align-items-center gx-3 row-gap-2'>
                <Col xs={12} lg={4} xl={5} className='d-flex align-items-center'>
                    <nav
                        aria-label='breadcrumb'
                        className='d-flex align-items-center flex-wrap gap-1 lh-sm'
                        style={{ minHeight: '42px' }}
                    >
                        <Link to='/' className='text-decoration-none'>
                            Models
                        </Link>
                        <span className='text-muted px-1'>/</span>
                        <span className='text-body'>
                            {model?.name || '...'}
                        </span>
                        <span className='text-muted px-1'>/</span>
                        {detailLabelId || trainingId ? (
                            <>
                                <Link to={detailParentLink} className='text-decoration-none'>
                                    {SECTIONS[activeSection]?.label || activeSection}
                                </Link>
                                <span className='text-muted px-1'>/</span>
                                {buildTab && (
                                    <>
                                        <span className='text-body'>
                                            {capitalise(buildTab)}
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
                                    {SECTIONS[activeSection]?.label || activeSection}
                                </span>
                                {buildTab && (
                                    <>
                                        <span className='text-muted px-1'>/</span>
                                        <span className='text-body'>
                                            {capitalise(buildTab)}
                                        </span>
                                    </>
                                )}
                            </>
                        )}
                    </nav>
                </Col>
                <Col xs={12} lg={8} xl={7} className='d-flex align-items-center'>
                    <Navbar expand='lg' collapseOnSelect className='p-0 w-100'>
                        <Navbar.Toggle aria-controls='model-subnav-collapse' className='border-0 ms-auto'>
                            <span className='navbar-toggler-icon' />
                            {' '}
                            {SECTIONS[activeSection]?.icon}
                            {' '}
                            {SECTIONS[activeSection]?.label}
                        </Navbar.Toggle>
                        <Navbar.Collapse id='model-subnav-collapse'>
                            <Nav
                                fill
                                variant='underline'
                                activeKey={activeSection}
                                className='justify-content-lg-end flex-nowrap overflow-auto w-100'
                            >
                                {Object.entries(SECTIONS).map(([key, { icon, label }]) => (
                                    <Nav.Item key={key}>
                                        <Nav.Link
                                            eventKey={key}
                                            as={Link}
                                            to={`${modelBasePath}/${key}`}
                                        >
                                            {icon}&nbsp;{label}
                                        </Nav.Link>
                                    </Nav.Item>
                                ))}
                            </Nav>
                        </Navbar.Collapse>
                    </Navbar>
                </Col>
            </Row>
        )}>
            {/* Inside the shell, so a crashing tab keeps the breadcrumb and
                sub-nav on screen and the user can click their way out. */}
            <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path="build" element={<Build />} />
                    <Route path="history" element={<History />} />
                    <Route path="history/:trainingId" element={<TrainingVersion />} />
                    <Route path="test" element={<Test />} />
                    <Route path="publish" element={<Publish />} />
                    <Route path="analyse" element={<Analyse />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="build/:labelId/utterances" element={<Utterances />} />
                </Routes>
            </Suspense>
            </RouteErrorBoundary>
        </PageShell>
    );
}

const Model = () => {

    return (
        <ModelProvider>
            <SocketProvider>
                <ModelContent />
            </SocketProvider>
        </ModelProvider>
    );
}

export default Model;
