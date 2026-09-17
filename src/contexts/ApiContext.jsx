import { createContext, useCallback, useContext, useMemo } from "react";
import createApi from "../api";
import { UserContext } from "./UserContext";
import { useSocket } from "./SocketContext";

export const ApiContext = createContext(null);

// Task states after which the request worker's response is in the store.
const READY = new Set(["SUCCESS", "FAILURE", "REVOKED", "ABORTED"]);

// Binds the API layer to the current session: the client is rebuilt whenever
// the token (or the socket) changes, and a 401 from any of its calls reports
// straight back to UserContext, which raises the session-expired modal.
//
// It also lends the session's Socket.IO connection to the client, so a
// request that came back 202 (a view running in the request worker) is
// resolved as soon as the worker pushes a terminal `status` into the task's
// room — the same rooms the training and serving tasks report into.
export const ApiProvider = ({ children }) => {
    const { user, expireSession } = useContext(UserContext);
    const socket = useSocket();

    const subscribe = useCallback(
        (taskId, onChange) => {
            if (!socket || !user) return null;
            const handleStatus = (payload) => {
                if (payload.task_id === taskId && READY.has(payload.status)) onChange();
            };
            // Rooms are per socket and do not survive a reconnect.
            const join = () => socket.emit("join", user.token, taskId);
            socket.on("status", handleStatus);
            socket.on("connect", join);
            if (socket.connected) join();
            return () => {
                socket.off("status", handleStatus);
                socket.off("connect", join);
                if (socket.connected) socket.emit("leave", user.token, taskId);
            };
        },
        [socket, user]
    );

    const api = useMemo(
        () => createApi(user?.token, expireSession, subscribe),
        [user?.token, expireSession, subscribe]
    );

    return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
};

export const useApi = () => useContext(ApiContext);
