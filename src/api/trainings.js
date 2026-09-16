import { data } from "./client";

export default (client) => ({
    // Every run of the caller's still pending or in progress, across models —
    // what the app-wide training strip seeds itself from.
    active: () => client.get("/api/trainings/active").then(data),
    list: (modelId, params) => client.get(`/api/models/${modelId}/trainings`, { params }).then(data),
    get: (modelId, trainingId, params) =>
        client.get(`/api/models/${modelId}/trainings/${trainingId}`, { params }).then(data),
    create: (modelId) => client.post(`/api/models/${modelId}/trainings`, {}).then(data),
    remove: (modelId, trainingId) =>
        client.delete(`/api/models/${modelId}/trainings/${trainingId}`).then(data),
    // `kwargs` are the run's hyperparameters; a restart replays the originals.
    start: (modelId, trainingId, kwargs = {}) =>
        client.post(`/api/models/${modelId}/trainings/${trainingId}/start`, kwargs).then(data),
    stop: (modelId, trainingId) =>
        client.post(`/api/models/${modelId}/trainings/${trainingId}/stop`, {}).then(data),
    // Per-epoch metric history behind the History plot.
    metrics: (modelId, trainingId) =>
        client.get(`/api/models/${modelId}/trainings/${trainingId}/data`).then(data),
    downloadArtifact: (modelId, trainingId) =>
        client.get(`/api/models/${modelId}/trainings/${trainingId}?format=zip`, { responseType: "blob" }).then(data),
});
