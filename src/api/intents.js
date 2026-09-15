import { data } from "./client";

// Intents are the classification label resource too — the backend route is
// /intents for both, and the UI only varies the noun it prints.
export default (client) => ({
    list: (modelId, params) => client.get(`/api/models/${modelId}/intents`, { params }).then(data),
    get: (modelId, intentId) => client.get(`/api/models/${modelId}/intents/${intentId}`).then(data),
    create: (modelId, body) => client.post(`/api/models/${modelId}/intents`, body).then(data),
    update: (modelId, intentId, body) =>
        client.put(`/api/models/${modelId}/intents/${intentId}`, body).then(data),
    remove: (modelId, intentId) =>
        client.delete(`/api/models/${modelId}/intents/${intentId}`).then(data),
    exportCsv: (modelId, intentId) =>
        client.get(`/api/models/${modelId}/intents/${intentId}?format=csv`, { responseType: "blob" }).then(data),

    listUtterances: (modelId, intentId, params) =>
        client.get(`/api/models/${modelId}/intents/${intentId}/utterances`, { params }).then(data),
    createUtterance: (modelId, intentId, body) =>
        client.post(`/api/models/${modelId}/intents/${intentId}/utterances`, body).then(data),
    updateUtterance: (modelId, intentId, utteranceId, body) =>
        client.put(`/api/models/${modelId}/intents/${intentId}/utterances/${utteranceId}`, body).then(data),
    removeUtterance: (modelId, intentId, utteranceId) =>
        client.delete(`/api/models/${modelId}/intents/${intentId}/utterances/${utteranceId}`).then(data),
});
