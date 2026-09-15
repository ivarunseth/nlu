import { data } from "./client";

export default (client) => ({
    list: (modelId, params) => client.get(`/api/models/${modelId}/slots`, { params }).then(data),
    create: (modelId, body) => client.post(`/api/models/${modelId}/slots`, body).then(data),
    update: (modelId, slotId, body) =>
        client.put(`/api/models/${modelId}/slots/${slotId}`, body).then(data),
    remove: (modelId, slotId) => client.delete(`/api/models/${modelId}/slots/${slotId}`).then(data),
});
