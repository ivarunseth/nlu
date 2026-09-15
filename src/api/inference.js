import { data } from "./client";
import axios from "axios";

// The data plane, kept off the session client on purpose: predictions
// authenticate with the *deployment's* API key, not the user's token. Routing
// these through the session client would both send the wrong credential and
// make a stale API key look like an expired session.
//
// The endpoint is batch-only; a single query is a one-element batch.
const authorize = (apiKey) => ({ headers: { Authorization: `Bearer ${apiKey || ""}` } });

// Called against the deployment's own absolute endpoint: each environment
// serves on its own data plane, so the environment being queried is named by
// the endpoint rather than inferred from where the UI happens to be served.
export const predictAt = (endpoint, inputs, { apiKey, top } = {}) =>
    axios.post(endpoint, { inputs }, { params: { top }, ...authorize(apiKey) }).then(data);
