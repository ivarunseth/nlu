import { data } from "./client";

export default (client) => ({
    list: (params) => client.get("/api/dataset/models", { params }).then(data),
    create: (body) => client.post("/api/dataset/models", body).then(data),
    get: (modelId) => client.get(`/api/dataset/models/${modelId}`).then(data),
    update: (modelId, body) => client.put(`/api/dataset/models/${modelId}`, body).then(data),
    remove: (modelId) => client.delete(`/api/dataset/models/${modelId}`).then(data),
    exportCsv: (modelId) =>
        client.get(`/api/dataset/models/${modelId}?format=csv`, { responseType: "blob" }).then(data),
});
