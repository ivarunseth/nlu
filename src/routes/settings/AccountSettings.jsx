import React, { useState, useContext } from "react";
import { Form, Button, Container, Row, Col } from 'react-bootstrap';
import { UserContext } from "../../contexts/UserContext";

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
            <Row className="justify-content-md-center">
                <Col md={6}>
                    <h2>Account Settings</h2>
                    <Form onSubmit={handleSave}>
                        <Form.Group controlId="formEmail">
                            <Form.Label>Email address</Form.Label>
                            <Form.Control
                                type="email"
                                placeholder="Enter email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </Form.Group>

                        <Form.Group controlId="formUsername">
                            <Form.Label>Username</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Enter username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </Form.Group>

                        <Form.Group controlId="formPassword">
                            <Form.Label>Password</Form.Label>
                            <Form.Control
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </Form.Group>

                        <Button variant="primary" type="submit">
                            Save Changes
                        </Button>
                    </Form>
                </Col>
            </Row>
        </Container>
    );
}

export default AccountSettings;
