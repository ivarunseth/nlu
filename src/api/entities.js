import { data } from "./client";

export default (client) => ({
    list: (modelId, params) => client.get(`/api/dataset/models/${modelId}/entities`, { params }).then(data),
    get: (modelId, entityId) => client.get(`/api/dataset/models/${modelId}/entities/${entityId}`).then(data),
    create: (modelId, body) => client.post(`/api/dataset/models/${modelId}/entities`, body).then(data),
    update: (modelId, entityId, body) =>
        client.put(`/api/dataset/models/${modelId}/entities/${entityId}`, body).then(data),
    remove: (modelId, entityId) =>
        client.delete(`/api/dataset/models/${modelId}/entities/${entityId}`).then(data),
});
