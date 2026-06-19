import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import Header from "./components/Header";
import Home from "./components/Home";
import SignIn from "./components/SignIn";
import SignUp from "./components/SignUp";
import Model from "./components/Model";
import AccountSettings from "./components/AccountSettings";
import Footer from "./components/Footer";

const App = () => {
    return (
        <Router>
            <UserProvider>
                <div className="d-flex flex-column min-vh-100">
                    <Header />
                    <main className="flex-grow-1">
                        <Routes>
                            <Route path="/signin" element={<SignIn />} />
                            <Route path="/signup" element={<SignUp />} />
                            <Route path="/" element={<Home />} />
                            <Route path="/settings" element={<AccountSettings />} />
                            <Route path="/models/:modelId/*" element={<Model />} />
                        </Routes>
                    </main>
                    <Footer />
                </div>
            </UserProvider>
        </Router>
    );
};

export default App;