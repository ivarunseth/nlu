import { data } from "./client";

export default (client) => ({
    list: (modelId, params) => client.get(`/api/models/${modelId}/entities`, { params }).then(data),
    get: (modelId, entityId) => client.get(`/api/models/${modelId}/entities/${entityId}`).then(data),
    create: (modelId, body) => client.post(`/api/models/${modelId}/entities`, body).then(data),
    update: (modelId, entityId, body) =>
        client.put(`/api/models/${modelId}/entities/${entityId}`, body).then(data),
    remove: (modelId, entityId) =>
        client.delete(`/api/models/${modelId}/entities/${entityId}`).then(data),
});
