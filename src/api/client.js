import axios from "axios";

// One axios instance per session token. Authentication lives here and nowhere
// else, which is what lets every call site drop its `headers: { Authorization
// ... }` argument.
//
// The 401 interceptor moved here from UserContext, and got simpler on the way:
// on the global axios it had to work out whether a 401 even belonged to the
// session, since sign-in (basic auth) and the inference plane (a deployment API
// key) both produce 401s of their own. Every request through *this* client
// carries the session token by construction, so a 401 here can only mean the
// session died. Sign-in uses no client at all and the inference plane has its
// own, so neither can reach this handler.
export const createClient = (token, onUnauthorized) => {
    const client = axios.create({
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (token && onUnauthorized) {
        client.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) onUnauthorized();
                // Re-thrown either way: callers keep their own catch blocks.
                return Promise.reject(error);
            }
        );
    }

    return client;
};

// Resource modules return response.data, which is the parsed body for JSON
// endpoints and the Blob itself for download endpoints — so callers never
// touch the axios response envelope.
export const data = (response) => response.data;
