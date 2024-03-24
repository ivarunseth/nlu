import { Container, Row, Col, Nav } from 'react-bootstrap';
import { Translate, ClockHistory, ClipboardCheck, RocketTakeoff, Activity } from 'react-bootstrap-icons';
import { Routes, Route, Link } from 'react-router-dom';
import { ModelProvider } from '../contexts/ModelContext';
import Build from './Build';
import Utterances from './Utterances';
import History from './History';

const Model = () => {

    return (
        <Container>
            <Row>
                <Col>
                    <Nav fill variant='underline' defaultActiveKey='build'>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='build'
                                as={Link}
                                to='build'
                            >
                                <Translate />&nbsp;Build
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='history'
                                as={Link}
                                to='history'
                            >
                                <ClockHistory />&nbsp;History
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='evaluate'
                                as={Link}
                                to='evaluate'
                            >
                                <ClipboardCheck />&nbsp;Evaluate
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='publish'
                                as={Link}
                                to='publish'
                            >
                                <RocketTakeoff />&nbsp;Publish
                            </Nav.Link>
                        </Nav.Item>
                        <Nav.Item>
                            <Nav.Link
                                eventKey='analyse'
                                as={Link}
                                to='analyse'
                            >
                                <Activity />&nbsp;Analyse
                            </Nav.Link>
                        </Nav.Item>
                    </Nav>
                </Col>
            </Row>
            <ModelProvider>
                <Routes>
                    <Route path="build" element={<Build />} />
                    <Route path="history" element={<History />} />
                    <Route path="/build/:labelId/utterances" element={<Utterances />} />
                </Routes>
            </ModelProvider>
        </Container>
    );
}

export default Model;