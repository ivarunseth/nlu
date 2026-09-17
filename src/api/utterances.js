import { data } from "./client";

// Model-scoped utterances: the NER and language-understanding surfaces, where
// an utterance carries annotation spans rather than belonging to a label. The
// intent-scoped ones live in intents.js, matching the two backend routes.
export default (client) => ({
    list: (modelId, params) => client.get(`/api/dataset/models/${modelId}/utterances`, { params }).then(data),
    create: (modelId, body) => client.post(`/api/dataset/models/${modelId}/utterances`, body).then(data),
    update: (modelId, utteranceId, body) =>
        client.put(`/api/dataset/models/${modelId}/utterances/${utteranceId}`, body).then(data),
    remove: (modelId, utteranceId) =>
        client.delete(`/api/dataset/models/${modelId}/utterances/${utteranceId}`).then(data),
    addTag: (modelId, utteranceId, span) =>
        client.post(`/api/dataset/models/${modelId}/utterances/${utteranceId}/tags`, span).then(data),
});
