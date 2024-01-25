import React, { useState } from "react";
import { Alert, Button, Card, Form, InputGroup, Spinner } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";

const SignUp = () => {

    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [alert, setAlert] = useState(null);

    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const handleSignUp = async (e) => {
        e.preventDefault();

        const form = e.currentTarget;

        if (form.checkValidity() === false) {
            e.stopPropagation();
        }

        setValidated(true);

        if (email !== '' && password !== '' && confirmPassword !== '') {
            setSubmitting(true)
            if (password !== confirmPassword) {
                setAlert({ variant: 'danger', message: 'Passwords do not match. Please try again.' });
                return;
            }
    
            try {
                let data = new FormData();
                data.append('email', email);
                data.append('password', password);
                const response = await axios.post('/api/users', data, {});
                if (response.status === 200)
                    navigate('/signin', { state: {alert: {variant: "success", message: "You have successfully signed up. Welcome aboard!"}}})
            } catch (error) {
                setAlert({ variant: 'danger', message: error.response.data.error });
            } finally {
                setValidated(false);
                setEmail('')
                setPassword('')
                setConfirmPassword('')
                setSubmitting(false)
            }
        }
    };

    return (
        <div className="d-flex justify-content-center align-items-center vh-100">
            <Card style={{ width: "30rem" }}>
                <Card.Body>
                    <Card.Title className="text-center mb-3">Sign up</Card.Title>

                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}

                    <Form noValidate validated={validated} onSubmit={handleSignUp}>
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
                                    placeholder="Enter a password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please enter a password.
                                </Form.Control.Feedback>
                            </InputGroup>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Confirm password</Form.Label>
                            <InputGroup hasValidation>
                                <Form.Control
                                    type="password"
                                    placeholder="Confirm password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                />
                                <Form.Control.Feedback type="invalid">
                                    Please confirm password.
                                </Form.Control.Feedback>
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
                                    Submitting
                                </>
                            ) : (
                                'Submit'
                            )}
                            </Button>
                        </div>
                        <Form.Text>Already have an account? <Link to='/signin'>Sign In</Link></Form.Text>
                    </Form>
                </Card.Body>
            </Card>
        </div>
    );
};

export default SignUp;