import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import { SocketProvider } from './contexts/SocketContext';
import Header from "./components/Header";
import Home from "./components/Home";
import SignIn from "./components/SignIn";
import SignUp from "./components/SignUp";
import Model from "./components/Model";

const App = () => {
    return (
        <Router>
            <UserProvider>
                <Header />
                <SocketProvider>
                    <Routes>
                        <Route path="/signin" element={<SignIn />} />
                        <Route path="/signup" element={<SignUp />} />
                        <Route path="/" element={<Home />} />
                    </Routes>
                    <Routes>
                        <Route path="/models/:modelId/*" element={<Model />} />
                    </Routes>
                </SocketProvider>
            </UserProvider>
        </Router>
    );
};

export default App;