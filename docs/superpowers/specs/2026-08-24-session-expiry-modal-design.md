# Session expiry: global 401 handling with a re-login modal

## Problem

User tokens expire after 12 hours (`TOKEN_EXPIRY = 720` minutes,
[server/config.py](../../../server/config.py)). Nothing in the frontend handles
that. An idle user sits on a page whose token has silently died; the first
action they take fires an API call that returns 401, and the call site's
`catch` block either logs to the console or paints a static inline error. The
user is given no indication that they have been logged out and no way to
recover other than reloading and guessing.

Expiry is terminal, not recoverable. `validate_token` in
[server/auth.py](../../../server/auth.py) calls `_invalidate_token` on an
`ExpiredSignatureError`, which nulls `user.token` in the database and clears the
session. There is no refresh token and no renewal endpoint, so the only correct
response is to tell the user plainly and send them back to sign-in.

## Scope

In: detecting an expired session in the React app, telling the user with a
blocking modal, and returning them to the page they were on after they sign
back in.

Out: any backend change; token refresh or sliding expiry; the 120-odd
individual `axios` call sites and their existing error handling; Socket.IO
reconnection behaviour.

## Approach

All ~120 `axios` calls across 22 files use the global `axios` object with a
per-call `Authorization: Bearer ${user.token}` header. A single global response
interceptor therefore covers every one of them without editing a single call
site. The alternative — a shared `useApi` hook — is the better long-term
structure but would mean rewriting every call site for what is a bug fix, so it
is explicitly deferred.

Session expiry lives in `UserProvider` because `UserContext` already owns the
token, its localStorage mirror, and every auth-related navigation. A separate
`SessionContext` was considered and rejected: it would hold one boolean while
depending on `UserContext` for the user and the router for navigation, which
spreads the auth flow across two files without isolating anything.

## Detection

Three signals all funnel into one idempotent `expireSession()`.

### Reactive: axios response interceptor

Registered in an effect in `UserProvider`, ejected on cleanup. A 401 is treated
as session expiry only when both hold:

- the failed request carried an `Authorization` header whose scheme is `Bearer`
- the request URL is not under `/api/infer/`

The first condition excludes sign-in. `signIn` posts to `/api/tokens` with
axios's `auth: {username, password}` option, which produces a **Basic** header,
so a wrong password returns 401 without tripping the interceptor. It also
excludes the unauthenticated sign-up and forgot-password calls, which send no
`Authorization` header at all.

The second condition is required because the Test page's inference calls
(`POST /api/infer/<model_id>` in
[src/routes/model/routes/test/Test.jsx](../../../src/routes/model/routes/test/Test.jsx))
*do* send a Bearer header — carrying the deployment's own API key, not the user
session token. A 401 there means a stale or rotated model API key and has its
own handling on that page.

The interceptor re-rejects the error in every case, including when it does
trigger expiry, so existing `catch` blocks keep running exactly as they do
today.

### Proactive: JWT expiry timer

New helper `src/shared/utils/token.js`:

```
getTokenExpiry(token) -> number | null   // ms since epoch, or null
```

It splits the JWT on `.`, base64url-decodes the payload segment, parses it, and
returns `exp * 1000`. Any malformed input, missing segment, bad JSON, or absent
`exp` returns `null` rather than throwing — a token the helper cannot read
simply means no timer, and the interceptor remains the safety net. No new
dependency; the payload is not verified, only read, which is appropriate since
the server is the authority.

An effect in `UserProvider` keyed on `user` computes the remaining lifetime and
schedules a `setTimeout`, or fires immediately if the deadline has already
passed. A 12-hour delay is far below the ~24.8-day `setTimeout` ceiling, so no
clamping is needed. The timer is cleared on cleanup and on sign-out.

### Wake-up: visibilitychange

A `visibilitychange` listener re-checks the expiry deadline whenever the tab
becomes visible. Browsers throttle or entirely skip timers while a machine
sleeps, which is precisely the 12-hour idle scenario this feature exists for, so
the timer alone cannot be trusted.

### Idempotency

`expireSession()` guards on a ref, not on state, so it is correct even when
several in-flight requests all 401 within the same tick. A page with parallel
requests raises exactly one modal.

## Behaviour on expiry

`expireSession()` sets `sessionExpired` to `true` and removes the `user` key
from localStorage. It deliberately **leaves `user` in React state**.

This is load-bearing. The existing effect in `UserContext` navigates to
`/signin` whenever `user` is null, so clearing the user eagerly would redirect
away from the page and unmount the modal along with it. Keeping the user in
memory holds the stale page rendered underneath the modal, which is what makes
the modal read as an interruption of the user's work rather than a mysterious
bounce to a login screen. The retained token is already dead server-side, so
holding it in memory grants nothing.

Requests fired after expiry will 401 and re-enter the interceptor; the ref guard
makes those no-ops.

## The modal

New presentational component `src/shared/components/SessionExpiredModal.jsx`,
following the shape of the existing
[DeleteConfirmationModal](../../../src/shared/components/DeleteConfirmationModal.jsx)
(props in, no state, no data fetching). Rendered by `UserProvider` alongside
`children` so it is available on every route.

It is blocking: `backdrop="static"`, `keyboard={false}`, no `closeButton`, and
no dismiss path. There is exactly one action, a **Sign in again** button,
because there is exactly one thing the user can do. Body copy states that the
session expired and that signing in again is required.

## Returning to the page

On expiry, `pathname + search` is written to `sessionStorage` under the key
`redirectAfterSignIn`. sessionStorage rather than in-memory state so the
destination survives a reload of the sign-in page, and rather than
localStorage so it does not leak into other tabs or outlive the browser
session.

Clicking **Sign in again** clears `user`, sets `sessionExpired` back to `false`,
and navigates to `/signin` with

```
state: { alert: { variant: 'warning', message: 'Your session expired. Please sign in again.' } }
```

reusing the `location.state.alert` banner that
[SignIn](../../../src/routes/auth/SignIn.jsx) already renders for the post-signup
message.

`signIn()` reads `redirectAfterSignIn`, removes it, and navigates there instead
of `/`. When the key is absent — an ordinary sign-in — it navigates to `/` as it
does today. `signOut()` also removes the key, so an explicit sign-out never
resurrects a route captured by an earlier expiry.

## Files

| File | Change |
|---|---|
| `src/shared/utils/token.js` | New. `getTokenExpiry(token)`. |
| `src/shared/components/SessionExpiredModal.jsx` | New. Presentational blocking modal. |
| `src/contexts/UserContext.jsx` | Interceptor, expiry timer, visibility check, `sessionExpired` state, renders the modal; `signIn`/`signOut` honour `redirectAfterSignIn`. |

No other frontend file changes. No backend changes.

## Known gap

Between expiry and the user clicking the button, the Socket.IO client may keep
retrying with the dead token; it disconnects when `user` goes null on that
click. The server refuses those connections
([server/events.py](../../../server/events.py)), so the only cost is noise in the
console. Left alone deliberately — fixing it means reworking `useSocket`'s
lifecycle, which is unrelated to this change.

## Verification

`npm run build`, per the project convention of building rather than testing the
frontend. Manual verification is available by temporarily lowering
`TOKEN_EXPIRY` to 1 minute and confirming: the modal appears while idle without
any interaction; the modal appears on the next API call if the timer was
missed; a wrong password on sign-in shows the inline alert and no modal; and
sign-in returns the user to the page they were on.
