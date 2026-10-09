import { data } from "./client";

export default (client) => ({
    dataset: (modelId) => client.get(`/api/analytics/models/${modelId}/dataset`).then(data),
    versions: (modelId) => client.get(`/api/analytics/models/${modelId}/versions`).then(data),
    confusions: (modelId, params) =>
        client.get(`/api/analytics/models/${modelId}/confusions`, { params }).then(data),
    coverage: (modelId, params) =>
        client.get(`/api/analytics/models/${modelId}/coverage`, { params }).then(data),
    live: (modelId, params) => client.get(`/api/analytics/models/${modelId}/live`, { params }).then(data),
});
