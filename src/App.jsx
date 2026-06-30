import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import Header from "./layout/Header";
import Footer from "./layout/Footer";

const SignIn = lazy(() => import("./routes/auth/SignIn"));
const SignUp = lazy(() => import("./routes/auth/SignUp"));
const Home = lazy(() => import("./routes/home/Home"));
const Model = lazy(() => import("./routes/model/Model"));
const AccountSettings = lazy(() => import("./routes/settings/AccountSettings"));

const App = () => {
    return (
        <Router>
            <UserProvider>
                <div className="d-flex flex-column min-vh-100">
                    <Header />
                    <main className="flex-grow-1">
                        <Suspense fallback={null}>
                            <Routes>
                                <Route path="/signin" element={<SignIn />} />
                                <Route path="/signup" element={<SignUp />} />
                                <Route path="/" element={<Home />} />
                                <Route path="/settings" element={<AccountSettings />} />
                                <Route path="/models/:modelId/*" element={<Model />} />
                            </Routes>
                        </Suspense>
                    </main>
                    <Footer />
                </div>
            </UserProvider>
        </Router>
    );
};

export default App;
