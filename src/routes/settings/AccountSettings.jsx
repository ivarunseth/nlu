import React, { useState, useContext } from "react";
import { Form, Button, Card, Container, Row, Col } from 'react-bootstrap';
import { PersonGear } from "react-bootstrap-icons";
import { UserContext } from "../../contexts/UserContext";
import { CardHeading } from "../../shared/components/SectionCard";

function AccountSettings() {
    const { user, setUser } = useContext(UserContext);
    const [email, setEmail] = useState(user.email);
    const [username, setUsername] = useState(user.username || "");
    const [password, setPassword] = useState("");

    const handleSave = async (e) => {
        e.preventDefault();
        // Logic to update the user info
        // try {
        //     const response = await axios.put(`/api/users/${user.id}`, )
        // }
        setUser({ email, username, password });
    };

    return (
        <Container fluid>
            <div className="page-context-bar" aria-hidden="true" />
            <Row className="justify-content-md-center mt-4">
                <Col md={6}>
                    <Card className="border-light overflow-hidden">
                        <CardHeading icon={<PersonGear />} title="Account settings" />
                        <Card.Body className="p-3">
                            <Form onSubmit={handleSave}>
                                <Form.Group className="mb-3">
                                    <Form.Floating>
                                        <Form.Control
                                            id="formEmail"
                                            type="email"
                                            placeholder="Enter email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                        />
                                        <Form.Label htmlFor="formEmail">Email address</Form.Label>
                                    </Form.Floating>
                                </Form.Group>

                                <Form.Group className="mb-3">
                                    <Form.Floating>
                                        <Form.Control
                                            id="formUsername"
                                            type="text"
                                            placeholder="Enter username"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                        />
                                        <Form.Label htmlFor="formUsername">Username</Form.Label>
                                    </Form.Floating>
                                </Form.Group>

                                <Form.Group className="mb-3">
                                    <Form.Floating>
                                        <Form.Control
                                            id="formPassword"
                                            type="password"
                                            placeholder="Password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                        />
                                        <Form.Label htmlFor="formPassword">Password</Form.Label>
                                    </Form.Floating>
                                </Form.Group>

                                <div className="d-flex justify-content-end">
                                    <Button variant="primary" size="sm" className="small" type="submit">
                                        SAVE CHANGES
                                    </Button>
                                </div>
                            </Form>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </Container>
    );
}

export default AccountSettings;
