import { data } from "./client";

export default (client) => ({
    dataset: (modelId) => client.get(`/api/models/${modelId}/analytics/dataset`).then(data),
    versions: (modelId) => client.get(`/api/models/${modelId}/analytics/versions`).then(data),
    confusions: (modelId, params) =>
        client.get(`/api/models/${modelId}/analytics/confusions`, { params }).then(data),
    coverage: (modelId, params) =>
        client.get(`/api/models/${modelId}/analytics/coverage`, { params }).then(data),
    live: (modelId, params) => client.get(`/api/models/${modelId}/analytics/live`, { params }).then(data),
});
