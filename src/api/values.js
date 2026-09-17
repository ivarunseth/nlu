import { data } from "./client";

// The catalogue of known values (and their synonyms) for a closed-list entity.
export default (client) => ({
    list: (modelId, entityId) =>
        client.get(`/api/dataset/models/${modelId}/entities/${entityId}/values`).then(data),
    create: (modelId, entityId, body) =>
        client.post(`/api/dataset/models/${modelId}/entities/${entityId}/values`, body).then(data),
    update: (modelId, entityId, valueId, body) =>
        client.put(`/api/dataset/models/${modelId}/entities/${entityId}/values/${valueId}`, body).then(data),
    remove: (modelId, entityId, valueId) =>
        client.delete(`/api/dataset/models/${modelId}/entities/${entityId}/values/${valueId}`).then(data),
});
