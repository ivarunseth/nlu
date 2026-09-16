import { data } from "./client";

// The Build page's JSON view: the whole authored dataset as one document,
// read and written back in a single transaction (see views/api/dataset.py).
export default (client) => ({
    get: (modelId) => client.get(`/api/models/${modelId}/dataset`).then(data),
    save: (modelId, document) => client.put(`/api/models/${modelId}/dataset`, document).then(data),
});
