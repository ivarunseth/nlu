import axios from "axios";
import { data } from "./client";

// Deliberately standalone rather than part of the ApiProvider namespace:
// UserContext owns the token, and ApiProvider is built *from* that token, so a
// UserContext that consumed the api context would close the loop. These two
// calls are also the only ones that authenticate with something other than a
// session bearer token.
//
// Sign-in uses HTTP basic auth, which is exactly why a wrong password cannot
// trip the session-expired modal: its 401 never passes through the session
// client's interceptor.
export const create = (email, password) =>
    axios.post("/api/tokens", {}, { auth: { username: email, password } }).then(data);

export const revoke = (token) =>
    axios.delete("/api/tokens", { headers: { Authorization: `Bearer ${token}` } });
