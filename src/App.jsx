import React, { lazy, Suspense } from "react";
import { createBrowserRouter, createRoutesFromElements, Outlet, Route, RouterProvider } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import { ApiProvider } from "./contexts/ApiContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SocketProvider } from "./contexts/SocketContext";
import { TrainingProvider } from "./contexts/TrainingContext";
import Header from "./layout/Header";
import RouteFallback from "./shared/components/RouteFallback";
import RouteErrorBoundary from "./shared/components/RouteErrorBoundary";
import Footer from "./layout/Footer";

const SignIn = lazy(() => import("./routes/auth/SignIn"));
const SignUp = lazy(() => import("./routes/auth/SignUp"));
const ForgotPassword = lazy(() => import("./routes/auth/ForgotPassword"));
const Home = lazy(() => import("./routes/home/Home"));
const Model = lazy(() => import("./routes/model/Model"));
const AccountSettings = lazy(() => import("./routes/settings/AccountSettings"));

// The frame every route renders inside: the session providers (which need
// the router's hooks, so they live in a layout route rather than around it),
// then header, page, footer in one flex column that fills the viewport so
// the footer sits at its bottom and pages can stretch (the Build rail runs
// to it). The footer doubles as the training strip while runs are going.
const Shell = () => (
    <UserProvider>
    <SocketProvider>
    <ApiProvider>
    <TrainingProvider>
        <div className="d-flex flex-column min-vh-100">
            <Header />
            <main className="app-main">
                <RouteErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                    <Outlet />
                </Suspense>
                </RouteErrorBoundary>
            </main>
            <Footer />
        </div>
    </TrainingProvider>
    </ApiProvider>
    </SocketProvider>
    </UserProvider>
);

// A data router (rather than <BrowserRouter>) so pages can block navigation
// with useBlocker — the JSON dataset view holds unsaved edits in memory and
// asks before they are lost.
const router = createBrowserRouter(createRoutesFromElements(
    <Route element={<Shell />}>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<AccountSettings />} />
        <Route path="/models/:modelId/*" element={<Model />} />
    </Route>
));

const App = () => (
    <ThemeProvider>
        <RouterProvider router={router} />
    </ThemeProvider>
);

export default App;
