import { Component } from "react";
import { Button } from "react-bootstrap";
import { ExclamationTriangleFill } from "react-bootstrap-icons";

// Contains a render crash to one route instead of blanking the whole app.
//
// Without this, a single throw anywhere below took out the entire tree — nav,
// breadcrumb and all — leaving a black page with nothing to click and the cause
// visible only in the console. React itself asks for a boundary in that case.
//
// Must be a class: getDerivedStateFromError and componentDidCatch have no hook
// equivalent. `resetKey` is how it recovers — see RouteErrorBoundary below.
class ErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Keep the console trace the boundary would otherwise swallow.
        console.error("Unhandled render error:", error, info?.componentStack);
    }

    componentDidUpdate(previous) {
        // Navigating away has to clear the error, otherwise the first crash
        // sticks and every later route renders the fallback instead.
        if (this.state.error && previous.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center px-4 py-5">
                <div
                    className="d-inline-flex align-items-center justify-content-center rounded-circle bg-danger-subtle text-danger-emphasis mb-3"
                    style={{ width: "3.5rem", height: "3.5rem" }}
                    aria-hidden="true"
                >
                    <ExclamationTriangleFill size={24} />
                </div>
                <h5 className="fw-semibold mb-2">This page didn't load</h5>
                <p className="text-body-secondary mb-3" style={{ maxWidth: "34rem" }}>
                    Something went wrong rendering this view. The rest of the app is still
                    working — you can move to another page, or try this one again.
                </p>
                <div className="d-flex gap-2">
                    <Button variant="primary" onClick={() => this.setState({ error: null })}>
                        Try again
                    </Button>
                    <Button variant="light" className="border" onClick={() => window.location.reload()}>
                        Reload the page
                    </Button>
                </div>
                {/* The message only — a stack trace here would be noise for the
                    user and is already in the console for whoever needs it. */}
                <code className="text-body-secondary mt-3" style={{ fontSize: "var(--app-text-xs)" }}>
                    {String(this.state.error?.message || this.state.error)}
                </code>
            </div>
        );
    }
}

export default ErrorBoundary;
