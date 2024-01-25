import React, { useContext, useState, useEffect } from "react";
import { Alert, Card, Form, InputGroup, Button, Spinner } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { useNavigate } from "react-router";
import { UserContext } from "../contexts/UserContext";

const SignIn = () => {

    const location = useLocation();
    const navigate = useNavigate();

    const { user, signIn } = useContext(UserContext);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [alert, setAlert] = useState(null);

    const [validated, setValidated] = useState(false);  
    const [submitting, setSubmitting] = useState(false);

    const handleSignIn = async (e) => {
        e.preventDefault();
        if (e.currentTarget.checkValidity() === false)
            e.stopPropagation();
        setValidated(true);
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
        <div className="d-flex justify-content-center align-items-center vh-100">
            <Card style={{ width: "30rem" }}>
                <Card.Body>
                    <Card.Title className="text-center mb-3">Sign in</Card.Title>

                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}

                    <Form noValidate validated={validated} onSubmit={handleSignIn}>
                        <Form.Group className="mb-3">
                            <Form.Label>Email</Form.Label>
                            <InputGroup hasValidation>
                                <Form.Control
                                    type="email"
                                    placeholder="Enter your email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please enter your email.
                                </Form.Control.Feedback>
                            </InputGroup>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Password</Form.Label>
                            <InputGroup hasValidation>
                                <Form.Control
                                    type="password"
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete='on'
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please enter your password.
                                </Form.Control.Feedback>
                            </InputGroup>
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
                                    Submitting...
                                </>
                            ) : (
                                'Submit'
                            )}
                            </Button>
                        </div>

                        <Form.Text>Don't have an account? <Link to='/signup' style={{textDecoration: 'none'}}>Sign up</Link></Form.Text>
                    </Form>
                </Card.Body>
            </Card>
        </div>
    );
};

export default SignIn;