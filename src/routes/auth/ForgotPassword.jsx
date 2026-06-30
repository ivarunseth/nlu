import React, { useContext, useState, useEffect, useRef } from "react";
import { Alert, Form, InputGroup, Button, Spinner, Row, Col, Container } from "react-bootstrap";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";
import axios from "axios";

const ForgotPassword = () => {

    const location = useLocation();
    const navigate = useNavigate();

    const { user } = useContext(UserContext);

    const [email, setEmail] = useState('');

    const [alert, setAlert] = useState(null);

    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const emailInput = useRef(null);

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        const valid = e.currentTarget.checkValidity()
        setValidated(true);
        if (!valid) {
            e.stopPropagation();
            return;
        }
        if (email !== '') {
            setSubmitting(true);
            try {
                let data = new FormData();
                data.append('email', email);
                await axios.post('/api/users/forgot-password', data);
                setAlert({ variant: 'success', message: 'If an account with that email exists, you will receive a password reset link shortly.' });
                setEmail('');
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response?.data?.error || 'Something went wrong. Please try again.' });
            } finally {
                setValidated(false);
                setSubmitting(false);
            }
        }
    };

    useEffect(() => {
        if (user)
            navigate('/');
    }, [user, navigate]);

    useEffect(() => {
        if (location.state && location.state.alert) {
            setAlert(location.state.alert);
        }
    }, [location.state]);

    return (
        <Container fluid className="d-flex flex-column justify-content-center align-items-center vh-100">
            <Row style={{ width: "25rem" }}>
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row style={{ width: "25rem" }}>
                <Col>
                    <Form noValidate validated={validated} onSubmit={handleForgotPassword}>
                        <Form.Group className="mb-3">
                            <InputGroup hasValidation>
                                <Form.Floating>
                                    <Form.Control
                                        id="email"
                                        ref={emailInput}
                                        type="email"
                                        placeholder="Enter your email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        isValid={validated && email && emailInput.current && emailInput.current.validity.valid}
                                        isInvalid={validated && (!email || (emailInput.current && !emailInput.current.validity.valid))}
                                    />
                                    {validated ? (
                                        <Form.Label className={`${(!email || (emailInput.current && !emailInput.current.validity.valid)) && 'text-danger'}`} htmlFor="email">
                                            {!email ? 'Enter your email' : !emailInput.current.validity.valid ? 'Invalid email' : 'Email'}
                                        </Form.Label>
                                    ) : (
                                        <Form.Label htmlFor="email">
                                            Email
                                        </Form.Label>
                                    )}
                                </Form.Floating>
                            </InputGroup>
                        </Form.Group>
                        <div className="d-grid gap-2 my-3">
                            <Button
                                type="submit"
                                variant="dark"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Spinner
                                            animation="border"
                                            size="sm"
                                        />
                                        &nbsp;
                                        Submitting...
                                    </>
                                ) : (
                                    <span>
                                        Submit
                                    </span>

                                )}
                            </Button>
                        </div>
                        <Form.Text
                            style={{
                                display: 'flex',
                                justifyContent: 'center'
                            }}
                        >
                            Back to&nbsp;<Link to='/signin' style={{ textDecoration: 'none' }}>sign in</Link>.
                        </Form.Text>
                    </Form>
                </Col>
            </Row>
        </Container>
    );
};

export default ForgotPassword;
