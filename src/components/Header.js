import React, { useContext } from "react";
import {Container, Nav, Navbar, NavDropdown} from 'react-bootstrap';
import { PersonCircle, BoxArrowLeft } from 'react-bootstrap-icons';
import { Link } from "react-router-dom";
import { UserContext } from "../contexts/UserContext";

function Header() {
    
    const { user, signOut } = useContext(UserContext)

    return (
        <>
            {user && <Navbar collapseOnSelect expand="lg" bg="light" data-bs-theme="light" className="bg-body-tertiary">
                <Container>
                    <Navbar.Brand as={Link} to="/">classify.ai</Navbar.Brand>
                    <Navbar.Toggle aria-controls="responsive-navbar-nav" />
                    <Navbar.Collapse id="responsive-navbar-nav">
                        <Nav className="ms-auto">
                            <NavDropdown title={user.email}>
                                <NavDropdown.Item>
                                    <PersonCircle/>&nbsp;Account settings
                                </NavDropdown.Item>
                                <NavDropdown.Divider/>
                                <NavDropdown.Item onClick={signOut}>
                                    <BoxArrowLeft/>&nbsp;Sign out
                                </NavDropdown.Item>
                            </NavDropdown>
                        </Nav>
                    </Navbar.Collapse>
                </Container>
            </Navbar>}
        </>
    );
}

export default Header;