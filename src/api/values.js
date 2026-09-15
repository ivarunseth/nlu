import { data } from "./client";

// The catalogue of known values (and their synonyms) for a closed-list entity.
export default (client) => ({
    list: (modelId, entityId) =>
        client.get(`/api/models/${modelId}/entities/${entityId}/values`).then(data),
    create: (modelId, entityId, body) =>
        client.post(`/api/models/${modelId}/entities/${entityId}/values`, body).then(data),
    update: (modelId, entityId, valueId, body) =>
        client.put(`/api/models/${modelId}/entities/${entityId}/values/${valueId}`, body).then(data),
    remove: (modelId, entityId, valueId) =>
        client.delete(`/api/models/${modelId}/entities/${entityId}/values/${valueId}`).then(data),
});
