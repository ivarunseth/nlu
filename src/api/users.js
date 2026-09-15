import { data } from "./client";

export default (client) => ({
    create: (body) => client.post("/api/users", body).then(data),
    update: (userId, body) => client.put(`/api/users/${userId}`, body).then(data),
    forgotPassword: (body) => client.post("/api/users/forgot-password", body).then(data),
});
