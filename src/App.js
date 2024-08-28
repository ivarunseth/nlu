import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import Header from "./components/Header";
import Home from "./components/Home";
import SignIn from "./components/SignIn";
import SignUp from "./components/SignUp";
import Model from "./components/Model";
import AccountSettings from "./components/AccountSettings";

const App = () => {
    return (
        <Router>
            <UserProvider>
                <Header />
                <Routes>
                    <Route path="/signin" element={<SignIn />} />
                    <Route path="/signup" element={<SignUp />} />
                    <Route path="/" element={<Home />} />
                    <Route path="/settings" element={<AccountSettings />} />
                    <Route path="/models/:modelId/*" element={<Model />} />
                </Routes>
            </UserProvider>
        </Router>
    );
};

export default App;