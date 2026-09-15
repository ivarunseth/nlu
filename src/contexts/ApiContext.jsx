import { createContext, useContext, useMemo } from "react";
import createApi from "../api";
import { UserContext } from "./UserContext";

export const ApiContext = createContext(null);

// Binds the API layer to the current session: the client is rebuilt whenever
// the token changes, and a 401 from any of its calls reports straight back to
// UserContext, which raises the session-expired modal.
export const ApiProvider = ({ children }) => {
    const { user, expireSession } = useContext(UserContext);
    const api = useMemo(
        () => createApi(user?.token, expireSession),
        [user?.token, expireSession]
    );

    return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
};

export const useApi = () => useContext(ApiContext);
