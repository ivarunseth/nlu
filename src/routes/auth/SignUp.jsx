import React, { useState, useRef } from "react";
import { Alert, Button, Container, Form, InputGroup, Spinner, Row, Col } from "react-bootstrap";
import { Eye, EyeSlash } from "react-bootstrap-icons";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../../contexts/ApiContext";

const SignUp = () => {

    const navigate = useNavigate();
    const api = useApi();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [alert, setAlert] = useState(null);

    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const emailInput = useRef(null);
    const passwordInput = useRef(null);

    const handleSignUp = async (e) => {
        e.preventDefault();
        const valid = e.currentTarget.checkValidity()
        setValidated(true);
        if (!valid) {
            e.stopPropagation();
            return;
        }
        if (email !== '' && password !== '') {
            setSubmitting(true)
            try {
                let data = new FormData();
                data.append('email', email);
                data.append('password', password);
                await api.users.create(data);
                navigate('/signin', { state: {alert: {variant: "success", message: "You have successfully signed up. Welcome aboard!"}}})
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                setValidated(false);
                setEmail('')
                setPassword('')
                setSubmitting(false)
            }
        }
    };

    return (
        <Container fluid className="d-flex flex-column justify-content-center align-items-center app-fill">
            <Row style={{width: "25rem"}}>
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row style={{width: "25rem"}}>
                <Col>
                    <Form noValidate validated={validated} onSubmit={handleSignUp}>
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
                        <Form.Group className="mb-3">
                            <InputGroup hasValidation>
                                <Form.Floating>
                                    <Form.Control
                                        id="password"
                                        ref={passwordInput}
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Enter password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        autoComplete='on'
                                        isValid={validated && password && passwordInput.current && passwordInput.current.validity.valid}
                                        isInvalid={validated && (!password || (passwordInput.current && !passwordInput.current.validity.valid))}
                                        style={{
                                            borderTopRightRadius: 0,
                                            borderBottomRightRadius: 0
                                        }}
                                    />
                                    {validated ? (
                                        <Form.Label className={`${(!password || (passwordInput.current && !passwordInput.current.validity.valid)) && 'text-danger'}`} htmlFor="password">
                                            {!password ? 'Enter your password' : !passwordInput.current.validity.valid ? 'Invalid password' : 'Password'}
                                        </Form.Label>
                                    ) : (
                                        <Form.Label htmlFor="password">
                                            Password
                                        </Form.Label>
                                    )}
                                </Form.Floating>
                                <InputGroup.Text onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? <EyeSlash /> : <Eye />}
                                </InputGroup.Text>
                            </InputGroup>
                            <Form.Text id="passwordHelpBlock" muted>
                                Your password must be 8-20 characters long, contain letters and numbers,
                                and must not contain spaces, special characters, or emoji.
                            </Form.Text>
                        </Form.Group>
                        <div className="d-grid gap-2 mb-3">
                            <Button
                                type="submit"
                                variant="primary"
                                disabled={submitting}
                            >
                            {submitting ? (
                                <>
                                    <Spinner 
                                        animation="border"
                                        size="sm"
                                    />
                                    &nbsp;
                                    Signing up
                                </>
                            ) : (
                                'Sign up'
                            )}
                            </Button>
                        </div>
                        <Form.Text
                            style={{
                                display: 'flex',
                                justifyContent: 'center'
                            }}
                        >
                            Already have an account?&nbsp;<Link to='/signin' style={{ textDecoration: 'none' }}>Sign In</Link>
                        </Form.Text>
                    </Form>
                </Col>
            </Row>
        </Container>
    );
};

export default SignUp;