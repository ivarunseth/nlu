import { data } from "./client";

// Dataset-level tag operations: annotation coverage stats, and the import /
// export round trip that shares its IOB conversion with training.
export default (client) => ({
    stats: (modelId, params) => client.get(`/api/models/${modelId}/tags/stats`, { params }).then(data),
    importDataset: (modelId, body) => client.post(`/api/models/${modelId}/tags/import`, body).then(data),
    exportDataset: (modelId, format) =>
        client.get(`/api/models/${modelId}/tags/export`, { params: { format }, responseType: "blob" }).then(data),
});
