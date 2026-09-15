import { useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";

// ErrorBoundary keyed to the current route, so a crash on one page clears as
// soon as the user navigates somewhere else. Both the path and the query string
// count: the Build page swaps its whole workspace on ?intent= / ?entity=, so a
// crash there has to clear on a search change too.
const RouteErrorBoundary = ({ children }) => {
    const location = useLocation();
    return (
        <ErrorBoundary resetKey={`${location.pathname}${location.search}`}>
            {children}
        </ErrorBoundary>
    );
};

export default RouteErrorBoundary;
