import { data } from "./client";

// An instance is a model deployed into one environment. Deploying and stopping
// are the same POST — the body names the environment and whether it is on.
export default (client) => ({
    list: (modelId) => client.get(`/api/publishing/models/${modelId}/instances`).then(data),
    deploy: (modelId, body, trainingId) =>
        client.post(`/api/publishing/models/${modelId}/instances`, body, { params: { training_id: trainingId } }).then(data),
    update: (modelId, instanceId, body) =>
        client.put(`/api/publishing/models/${modelId}/instances/${instanceId}`, body).then(data),
});
