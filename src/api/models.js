import { data } from "./client";

export default (client) => ({
    list: (params) => client.get("/api/models", { params }).then(data),
    create: (body) => client.post("/api/models", body).then(data),
    get: (modelId) => client.get(`/api/models/${modelId}`).then(data),
    update: (modelId, body) => client.put(`/api/models/${modelId}`, body).then(data),
    remove: (modelId) => client.delete(`/api/models/${modelId}`).then(data),
    exportCsv: (modelId) =>
        client.get(`/api/models/${modelId}?format=csv`, { responseType: "blob" }).then(data),
});
