import { data } from "./client";

export default (client) => ({
    create: (body) => client.post("/api/auth/users", body).then(data),
    update: (userId, body) => client.put(`/api/auth/users/${userId}`, body).then(data),
    forgotPassword: (body) => client.post("/api/auth/users/forgot-password", body).then(data),
});
