import React, { useContext, useState, useEffect, useRef } from "react";
import { Alert, Form, InputGroup, Button, Spinner, Row, Col, Container } from "react-bootstrap";
import { Eye, EyeSlash } from "react-bootstrap-icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";

const SignIn = () => {

    const location = useLocation();
    const navigate = useNavigate();

    const { user, signIn } = useContext(UserContext);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [alert, setAlert] = useState(null);

    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const emailInput = useRef(null);
    const passwordInput = useRef(null);

    const handleSignIn = async (e) => {
        e.preventDefault();
        const valid = e.currentTarget.checkValidity()
        setValidated(true);
        if (!valid) {
            e.stopPropagation();
            return;
        }
        if (email !== '' && password !== '') {
            setSubmitting(true);
            try {
                await signIn(email, password);
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                setValidated(false);
                setPassword('')
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
                    <Form noValidate validated={validated} onSubmit={handleSignIn}>
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
                        </Form.Group>
                        <Form.Text>
                            <Link to='/forgot-password' style={{ textDecoration: 'none' }}>Forgot password?</Link>
                        </Form.Text>
                        <div className="d-grid gap-2 my-3">
                            <Button
                                type="submit"
                                variant="light"
                                className="border"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Spinner
                                            animation="border"
                                            size="sm"
                                        />
                                        &nbsp;
                                        Signing in...
                                    </>
                                ) : (
                                    <span>
                                        Sign in
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
                            Don't have an account?&nbsp;<Link to='/signup' style={{ textDecoration: 'none' }}>Sign up</Link>
                        </Form.Text>
                    </Form>
                </Col>
            </Row>
        </Container>
    );
};

export default SignIn;
