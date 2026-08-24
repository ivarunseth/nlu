# Session Expiry Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user's 12-hour session token expires, show a blocking modal explaining they were signed out and return them to the page they were on after they sign in again.

**Architecture:** A single global `axios` response interceptor registered in `UserProvider` catches any 401 that carried the session bearer token, and a `setTimeout` derived from the JWT's own `exp` claim fires the same handler while the user is idle. Both funnel into one idempotent `expireSession()` that raises a non-dismissible modal over the current page. No backend change; none of the ~120 individual `axios` call sites are touched.

**Tech Stack:** React 19, react-router-dom 7, react-bootstrap 2, axios 1.18, Vite.

**Spec:** [docs/superpowers/specs/2026-08-24-session-expiry-modal-design.md](../specs/2026-08-24-session-expiry-modal-design.md)

## Global Constraints

- **There is no runnable test suite.** `package.json` has no `test` script and jest is not installed — only `@testing-library/*`. Do not write jest tests and do not run `npm test`; it will fail. The verification gate for frontend work in this repo is `npm run build` (per [CLAUDE.md](../../../CLAUDE.md)). Task 1 additionally ships a real Node check because its subject is a pure function.
- **Do not run `git commit` unless the user has explicitly asked for commits.** The commit step in each task is written out ready to run, but is opt-in. This is a standing preference of this user's and overrides the skill default of frequent commits.
- **Do not add dependencies.** Everything here uses `atob`, `sessionStorage`, `document.visibilitychange`, and packages already in `package.json`.
- **Do not modify any backend file.** `TOKEN_EXPIRY = 720` in `server/config.py` stays as it is.
- **Scratchpad path** used by Task 1:
  `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f30578c3-f916-4917-a5b8-35031b6546ea/scratchpad`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/utils/token.js` | **New.** Pure function: read the `exp` claim out of a JWT. No React, no axios, no side effects. |
| `src/shared/components/SessionExpiredModal.jsx` | **New.** Presentational blocking modal. Props in, no state, no data fetching — matches `DeleteConfirmationModal`. |
| `src/contexts/UserContext.jsx` | **Modify.** Owns detection (interceptor + timer + visibility), the `sessionExpired` flag, the post-login redirect key, and renders the modal. |

`UserContext.jsx` is 60 lines today and grows to roughly 140. That is still one clear responsibility — it is the auth module — so it is not split.

---

### Task 1: `getTokenExpiry` JWT helper

**Files:**
- Create: `src/shared/utils/token.js`
- Check script (throwaway, not committed): `<scratchpad>/check-token.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `getTokenExpiry(token: unknown) => number | null` — milliseconds since the Unix epoch, or `null` when the token is unreadable or carries no numeric `exp`. Named export. Task 3 imports it.

- [ ] **Step 1: Write the implementation**

Create `src/shared/utils/token.js`:

```js
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
```

- [ ] **Step 2: Write the check script**

The helper is an ES module in a package with no `"type": "module"`, so Node would parse `token.js` as CommonJS and choke on `export`. Copy it to a `.mjs` name and import that — same source, no project change:

```bash
SCRATCH=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f30578c3-f916-4917-a5b8-35031b6546ea/scratchpad
cp src/shared/utils/token.js "$SCRATCH/token.mjs"
```

Write `<scratchpad>/check-token.mjs`:

```js
import assert from "node:assert/strict";
import { getTokenExpiry } from "./token.mjs";

// Buffer's base64url output is unpadded and uses -/_ , which is exactly the
// shape PyJWT emits, so this exercises the padding restoration above.
const sign = (payload) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

// A real exp claim comes back as milliseconds.
assert.equal(getTokenExpiry(sign({ id: 1, exp: 1800000000 })), 1800000000000);

// A payload long enough to need two padding characters still parses.
assert.equal(getTokenExpiry(sign({ id: 1, exp: 1800000000, note: "aa" })), 1800000000000);

// Past expiry is returned as-is; the caller decides what to do with it.
assert.equal(getTokenExpiry(sign({ id: 1, exp: 1 })), 1000);

// Anything unreadable is null, never a throw.
assert.equal(getTokenExpiry(sign({ id: 1 })), null, "no exp claim");
assert.equal(getTokenExpiry(sign({ id: 1, exp: "soon" })), null, "non-numeric exp");
assert.equal(getTokenExpiry("not.a.jwt"), null, "payload is not base64 JSON");
assert.equal(getTokenExpiry("two.segments"), null, "wrong segment count");
assert.equal(getTokenExpiry(""), null, "empty string");
assert.equal(getTokenExpiry(null), null, "null");
assert.equal(getTokenExpiry(undefined), null, "undefined");
assert.equal(getTokenExpiry({ exp: 1800000000 }), null, "not a string");

console.log("getTokenExpiry: all checks passed");
```

- [ ] **Step 3: Run the check**

```bash
node /private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f30578c3-f916-4917-a5b8-35031b6546ea/scratchpad/check-token.mjs
```

Expected output: `getTokenExpiry: all checks passed`

If an assertion fails, Node prints `AssertionError` naming the failing case. Fix `token.js`, re-copy it to `token.mjs`, and re-run.

- [ ] **Step 4: Commit** *(only if the user has asked for commits)*

```bash
git add src/shared/utils/token.js && git commit -m "added a JWT exp-claim reader for client-side session expiry"
```

---

### Task 2: `SessionExpiredModal` component

**Files:**
- Create: `src/shared/components/SessionExpiredModal.jsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: default export `SessionExpiredModal`, props `{ show: boolean, onSignIn: () => void }`. Task 3 renders it.

- [ ] **Step 1: Write the component**

Create `src/shared/components/SessionExpiredModal.jsx`:

```jsx
import { Button, Modal } from "react-bootstrap";

// Expiry is terminal: server/auth.py nulls the token in the database when it
// expires, so there is nothing to refresh and exactly one thing the user can
// do. Hence no close button, no backdrop click, no escape key.
const SessionExpiredModal = ({ show, onSignIn }) => (
    <Modal centered show={show} backdrop="static" keyboard={false}>
        <Modal.Header>
            <Modal.Title>Your session has expired</Modal.Title>
        </Modal.Header>
        <Modal.Body>
            <p>
                You were signed out because your session expired after 12 hours.
                Sign in again to pick up where you left off.
            </p>
            <Button variant="primary" onClick={onSignIn}>
                Sign in again
            </Button>
        </Modal.Body>
    </Modal>
);

export default SessionExpiredModal;
```

The button lives in `Modal.Body` rather than a `Modal.Footer` because that is what
`src/shared/components/DeleteConfirmationModal.jsx` does; match it.

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: `✓ built in …s`, exit code 0. The component is not imported by anything yet, so this only proves it parses — Task 3 wires it in.

- [ ] **Step 3: Commit** *(only if the user has asked for commits)*

```bash
git add src/shared/components/SessionExpiredModal.jsx && git commit -m "added a blocking session-expired modal"
```

---

### Task 3: Wire detection and recovery into `UserContext`

**Files:**
- Modify: `src/contexts/UserContext.jsx` (whole file — it is 60 lines; replace it)

**Interfaces:**
- Consumes: `getTokenExpiry(token) => number | null` from Task 1; `<SessionExpiredModal show onSignIn />` from Task 2.
- Produces: the `UserContext` value gains `sessionExpired: boolean`. Existing consumers (`Header`, `SignIn`, `ModelContext`, `useSocket`, every route) keep using `user`, `signIn`, `signOut`, `setUser`, `signUp` unchanged.

- [ ] **Step 1: Replace the file**

Write `src/contexts/UserContext.jsx`:

```jsx
import { createContext, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { getTokenExpiry } from "../shared/utils/token";
import SessionExpiredModal from "../shared/components/SessionExpiredModal";

export const UserContext = createContext();

// Where to send the user once they sign back in. sessionStorage rather than
// component state so it survives a reload of the sign-in page, and rather than
// localStorage so it neither leaks into other tabs nor outlives the browser.
const REDIRECT_KEY = "redirectAfterSignIn";

// A 401 only means "the session expired" when the request actually carried the
// session token. Sign-in sends Basic auth, sign-up and forgot-password send no
// Authorization header at all, and the Test page's /api/infer calls carry the
// deployment's *model API key* as a bearer token — a 401 there means a stale
// key and is handled on that page.
const isSessionRequest = (config) => {
    if (!config) return false;
    if ((config.url || "").startsWith("/api/infer/")) return false;
    const headers = config.headers;
    if (!headers) return false;
    // axios 1.x normalises request headers into an AxiosHeaders instance, but
    // rejected configs can still surface a plain object.
    const authorization = typeof headers.get === "function"
        ? headers.get("Authorization")
        : (headers.Authorization ?? headers.authorization);
    return typeof authorization === "string" && authorization.startsWith("Bearer ");
};

export const UserProvider = ({ children }) => {

    const [user, setUser] = useState(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    // Guarded by a ref rather than by `sessionExpired` so that a page with
    // several requests in flight raises one modal, not one per 401 — state
    // updates would not have landed yet when the second rejection arrives.
    const expiring = useRef(false);
    // The interceptor is registered once but needs the live location to record
    // where to return to; a ref keeps it out of the effect's dependencies.
    const locationRef = useRef(location);
    locationRef.current = location;

    const expireSession = useCallback(() => {
        if (expiring.current) return;
        expiring.current = true;
        const { pathname, search } = locationRef.current;
        if (pathname !== "/signin") {
            sessionStorage.setItem(REDIRECT_KEY, `${pathname}${search}`);
        }
        // Drop the stored token so a reload lands on sign-in, but deliberately
        // leave `user` in state: the redirect effect below bounces to /signin
        // the moment it goes null, which would unmount the modal along with the
        // page underneath it. The retained token is already dead server-side.
        localStorage.removeItem("user");
        setSessionExpired(true);
    }, []);

    // The user acknowledged the modal: now it is safe to tear the session down.
    const acknowledgeExpiry = () => {
        setSessionExpired(false);
        setUser(null);
        navigate("/signin", {
            state: {
                alert: {
                    variant: "warning",
                    message: "Your session expired. Please sign in again."
                }
            }
        });
    };

    useEffect(() => {
        const storedUser = JSON.parse(localStorage.getItem("user"));
        const anonymous = ["/signin", "/signup", "/forgot-password"];
        if (!user && !storedUser && !anonymous.includes(location.pathname)) {
            navigate('/signin');
        } else if (!user && storedUser) {
            setUser(storedUser);
            navigate('/');
        }
    }, [user, navigate, location.pathname]);

    // Reactive detection: any 401 on a request that carried the session token.
    // The error is re-rejected either way, so every existing catch block at the
    // ~120 call sites keeps behaving exactly as it does today.
    useEffect(() => {
        const interceptor = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401 && isSessionRequest(error.config)) {
                    expireSession();
                }
                return Promise.reject(error);
            }
        );
        return () => axios.interceptors.response.eject(interceptor);
    }, [expireSession]);

    // Proactive detection: an idle user should not have to click something to
    // discover they were signed out, so fire on the token's own deadline.
    useEffect(() => {
        if (!user || sessionExpired) return;
        const expiresAt = getTokenExpiry(user.token);
        if (expiresAt === null) return;

        let timer = null;
        const check = () => {
            const remaining = expiresAt - Date.now();
            if (remaining <= 0) {
                expireSession();
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(check, remaining);
        };
        check();

        // Timers are throttled or skipped outright while the machine sleeps,
        // which is precisely the 12-hour idle case this exists for, so re-check
        // whenever the tab comes back to the foreground.
        const onVisibility = () => {
            if (document.visibilityState === "visible") check();
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [user, sessionExpired, expireSession]);

    const signUp = async (email, password) => {
        let data = new FormData();
        data.append('email', email);
        data.append('password', password);
        navigate('/signin', {
            state: {
                alert: {
                    variant: "success",
                    message: "You have successfully signed up. Welcome aboard!"
                }
            }
        });
    };

    const signIn = async (email, password) => {
        if (!user) {
            const response = await axios.post('/api/tokens', {}, {auth: {username: email, password: password}});
            // Consume the route captured when the session expired, if any; an
            // ordinary sign-in has no key and lands on the home page.
            const redirect = sessionStorage.getItem(REDIRECT_KEY);
            sessionStorage.removeItem(REDIRECT_KEY);
            expiring.current = false;
            setUser(response.data);
            localStorage.setItem("user", JSON.stringify(response.data));
            navigate(redirect || "/");
        }
    }

    const signOut = async () => {
        if (user) {
            axios.delete('/api/tokens', {headers: {Authorization : `Bearer ${user.token}`}});
            // An explicit sign-out must never resurrect a route captured by an
            // earlier expiry.
            sessionStorage.removeItem(REDIRECT_KEY);
            expiring.current = false;
            localStorage.removeItem("user");
            setUser(null);
            navigate("/signin");
        }
    };

    return (
        <UserContext.Provider value={{ user, setUser, signUp, signIn, signOut, sessionExpired }}>
            {children}
            <SessionExpiredModal show={sessionExpired} onSignIn={acknowledgeExpiry} />
        </UserContext.Provider>
    );
};
```

- [ ] **Step 2: Note the one behavioural change to existing code**

`/signin` was added to the redirect effect's exempt list. Without it, `acknowledgeExpiry` navigates to `/signin` **with** the alert state, then the effect immediately re-navigates to `/signin` **without** state and the alert vanishes. The self-navigation it removes was a no-op in every other case.

Everything else in `signUp`, `signIn`, and `signOut` is unchanged apart from the redirect-key bookkeeping.

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: `✓ built in …s`, exit code 0, no warnings naming `UserContext`, `token`, or `SessionExpiredModal`.

- [ ] **Step 4: Commit** *(only if the user has asked for commits)*

```bash
git add src/contexts/UserContext.jsx && git commit -m "surfaced session expiry as a blocking modal with return-to-page sign-in"
```

---

### Task 4: Verification

**Files:** none modified.

- [ ] **Step 1: Confirm the whole frontend builds**

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 2: Confirm no call site was disturbed**

```bash
git diff --stat
```

Expected: exactly `src/contexts/UserContext.jsx` modified, plus the two new untracked files. No route or component file appears.

- [ ] **Step 3: Hand the manual checklist to the user**

This user verifies UI himself. Do not drive a browser preview. Report that the build passes and give him this checklist, noting it needs `TOKEN_EXPIRY` temporarily lowered in `server/config.py` (line 49) to about `2` minutes and the Flask server restarted:

1. Sign in, then leave the tab open and untouched past the expiry — the modal appears on its own, with no click.
2. Sign in, wait past expiry with the tab backgrounded, then return to it — the modal appears on focus.
3. Sign in, wait past expiry, then click something that fires an API call — the modal appears, and the page's own error banner does not.
4. From a model page, let it expire and click **Sign in again** — the sign-in page shows the warning alert, and signing in returns to that model page rather than home.
5. Sign in with a wrong password — the inline red alert appears and the modal does **not**.
6. On the Test page of a published model, break the API key and send a query — the page's own error handling runs and the modal does **not**.
7. Sign out normally, then sign back in — lands on the home page, not on a stale route.

Once confirmed, restore `TOKEN_EXPIRY` to `720`.
