import React from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { Github, Twitter, Linkedin } from 'react-bootstrap-icons';

const Footer = () => {
    return (
        <footer className="bg-light border-top mt-auto py-4">
            <Container fluid>
                <Row className="align-items-center gy-3">
                    <Col xs={12} md={4} className="text-center text-md-start">
                        <span className="text-muted small">
                            © {new Date().getFullYear()} classify.ai. All rights reserved.
                        </span>
                    </Col>
                    <Col xs={12} md={4} className="text-center">
                        <div className="d-flex justify-content-center gap-3">
                            <a href="/" className="text-muted text-decoration-none small">Privacy Policy</a>
                            <a href="/" className="text-muted text-decoration-none small">Terms of Service</a>
                            <a href="/" className="text-muted text-decoration-none small">Contact</a>
                        </div>
                    </Col>
                    <Col xs={12} md={4} className="text-center text-md-end">
                        <div className="d-flex justify-content-center justify-content-md-end gap-3">
                            <a href="https://github.com" className="text-muted" aria-label="Github">
                                <Github size={18} />
                            </a>
                            <a href="https://twitter.com" className="text-muted" aria-label="Twitter">
                                <Twitter size={18} />
                            </a>
                            <a href="https://linkedin.com" className="text-muted" aria-label="Linkedin">
                                <Linkedin size={18} />
                            </a>
                        </div>
                    </Col>
                </Row>
            </Container>
        </footer>
    );
};

export default Footer;
