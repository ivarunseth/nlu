/**
 * Read the `exp` claim out of a JWT without verifying it.
 *
 * The server is the sole authority on whether a token is valid — this is used
 * only to schedule a client-side expiry timer, so an unreadable token means
 * "no timer" rather than an error. The axios interceptor remains the safety
 * net in that case.
 */
export const getTokenExpiry = (token) => {
    if (typeof token !== "string") return null;
    const segments = token.split(".");
    if (segments.length !== 3) return null;
    try {
        // JWT payloads are base64url: restore the standard alphabet and the
        // padding that base64url drops before handing it to atob.
        const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
        const padding = (4 - (base64.length % 4)) % 4;
        const payload = JSON.parse(atob(base64 + "=".repeat(padding)));
        return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
};
