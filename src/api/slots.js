import { data } from "./client";

export default (client) => ({
    list: (modelId, params) => client.get(`/api/dataset/models/${modelId}/slots`, { params }).then(data),
    create: (modelId, body) => client.post(`/api/dataset/models/${modelId}/slots`, body).then(data),
    update: (modelId, slotId, body) =>
        client.put(`/api/dataset/models/${modelId}/slots/${slotId}`, body).then(data),
    remove: (modelId, slotId) => client.delete(`/api/dataset/models/${modelId}/slots/${slotId}`).then(data),
});
