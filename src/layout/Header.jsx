import React, { useContext } from "react";
import {Container, Nav, Navbar, NavDropdown} from 'react-bootstrap';
import { PersonCircle, BoxArrowLeft } from 'react-bootstrap-icons';
import { Link } from "react-router-dom";
import { UserContext } from "../contexts/UserContext";
import ThemeToggle from "../shared/components/ThemeToggle";

function Header() {
    
    const { user, signOut } = useContext(UserContext)

    return (
        <>
            {user && <Navbar collapseOnSelect expand="lg" className="bg-body-tertiary">
                <Container fluid>
                    <Navbar.Brand as={Link} to="/">classify.ai</Navbar.Brand>
                    <Navbar.Toggle aria-controls="responsive-navbar-nav" />
                    <Navbar.Collapse id="responsive-navbar-nav">
                        <Nav className="ms-auto align-items-lg-center">
                            <ThemeToggle />
                            <NavDropdown title={user.email}>
                                <NavDropdown.Item as={Link} to="/settings">
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