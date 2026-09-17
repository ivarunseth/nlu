import axios from "axios";

// Long-running endpoints (dataset import/export, analytics, cascading
// deletes — see server.blueprints.apply_async) answer 202 with a Location
// header while a request worker runs the view. The interceptor below hides
// that from call sites: it waits for the task to finish, then fetches the
// stored response from Location with the caller's own responseType, so a
// download still resolves to a Blob and a JSON endpoint to parsed JSON.
//
// `subscribe(taskId, onChange)` is supplied by ApiContext and rides the
// session's Socket.IO connection: the worker pushes `status` events into
// the task-id room, so the result is fetched the moment it exists. A slow
// poll backs it up in case the socket drops; without a socket at all the
// poll is the only mechanism and runs faster.
const PENDING = (response) => response.status === 202 && !!response.headers?.location;

const POLL_WITH_SOCKET = 5000;
const POLL_WITHOUT_SOCKET = 1000;

const settle = (client, response, subscribe) => {
    const location = response.headers.location;
    const taskId = location.split("/").pop();
    const fetchResult = () =>
        client.get(location, { responseType: response.config.responseType, _status: true });

    return new Promise((resolve, reject) => {
        let done = false;
        let unsubscribe = null;
        let timer = null;

        const finish = (settleWith) => {
            if (done) return;
            done = true;
            unsubscribe?.();
            clearInterval(timer);
            settleWith();
        };

        const check = async () => {
            if (done) return;
            try {
                const result = await fetchResult();
                if (!PENDING(result)) finish(() => resolve(result));
            } catch (error) {
                finish(() => reject(error));
            }
        };

        unsubscribe = subscribe?.(taskId, check) ?? null;
        timer = setInterval(check, unsubscribe ? POLL_WITH_SOCKET : POLL_WITHOUT_SOCKET);
        // The task may already have finished before the room was joined.
        check();
    });
};

// One axios instance per session token. Authentication lives here and nowhere
// else, which is what lets every call site drop its `headers: { Authorization
// ... }` argument.
//
// The 401 interceptor moved here from UserContext, and got simpler on the way:
// on the global axios it had to work out whether a 401 even belonged to the
// session, since sign-in (basic auth) and the inference endpoints (a deployment
// API key) both produce 401s of their own. Every request through *this* client
// carries the session token by construction, so a 401 here can only mean the
// session died. Sign-in uses no client at all and inference has its own, so
// neither can reach this handler.
export const createClient = (token, onUnauthorized, subscribe) => {
    const client = axios.create({
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    client.interceptors.response.use((response) => {
        // Status-route fetches pass through untouched, or they would recurse.
        if (response.config._status || !PENDING(response)) return response;
        return settle(client, response, subscribe);
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
