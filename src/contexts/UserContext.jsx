import { createContext, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as tokens from "../api/tokens";
import { getTokenExpiry } from "../shared/utils/token";
import SessionExpiredModal from "../shared/components/SessionExpiredModal";

export const UserContext = createContext();

// Where to send the user once they sign back in. sessionStorage rather than
// component state so it survives a reload of the sign-in page, and rather than
// localStorage so it neither leaks into other tabs nor outlives the browser.
const REDIRECT_KEY = "redirectAfterSignIn";

export const UserProvider = ({ children }) => {

    const [user, setUser] = useState(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    // Guarded by a ref rather than by `sessionExpired` so that a page with
    // several requests in flight raises one modal, not one per 401 — state
    // updates would not have landed yet when the second rejection arrives.
    const expiring = useRef(false);
    // expireSession has to record where to return to, but must stay
    // referentially stable — ApiProvider memoizes the API client on it, so a
    // new identity every render would rebuild the client and its interceptor
    // on every navigation. A ref gives it the live location without becoming
    // a dependency.
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
        // Read the pathname from the DOM, not from useLocation(). navigate()
        // updates window.location synchronously, but the router's location can
        // lag it by a commit — so when signOut() nulls the user and navigates
        // in the same breath, this effect runs seeing "no session" together
        // with the pathname of the page we just left. It then pushed /signin a
        // second time, and that stateless push wiped the alert the explicit
        // navigate() had attached. Same for the session-expiry hand-off.
        const pathname = window.location.pathname;
        if (!user && !storedUser && !anonymous.includes(pathname)) {
            navigate('/signin');
        } else if (!user && storedUser) {
            // Restoring a session from storage on reload. Only navigate when
            // the current route is one a signed-in user has no business on —
            // otherwise the URL is already correct, and sending them home threw
            // away the page they reloaded (or the one they were returned to
            // after their session expired).
            setUser(storedUser);
            if (anonymous.includes(pathname)) navigate('/');
        }
    }, [user, navigate, location.pathname]);

    // Reactive detection now lives on the API client (src/api/client.js): every
    // request through it carries the session token by construction, so a 401
    // there can only mean the session died — no need to inspect the request to
    // tell a real expiry from a wrong password or a stale deployment API key.

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
            const session = await tokens.create(email, password);
            // Consume the route captured when the session expired, if any; an
            // ordinary sign-in has no key and lands on the home page.
            const redirect = sessionStorage.getItem(REDIRECT_KEY);
            sessionStorage.removeItem(REDIRECT_KEY);
            expiring.current = false;
            setUser(session);
            localStorage.setItem("user", JSON.stringify(session));
            navigate(redirect || "/");
        }
    }

    const signOut = async () => {
        if (user) {
            tokens.revoke(user.token);
            // An explicit sign-out must never resurrect a route captured by an
            // earlier expiry.
            sessionStorage.removeItem(REDIRECT_KEY);
            expiring.current = false;
            localStorage.removeItem("user");
            setUser(null);
            navigate("/signin", {
                state: {
                    alert: {
                        variant: "info",
                        message: "You have been signed out."
                    }
                }
            });
        }
    };

    return (
        <UserContext.Provider value={{ user, setUser, signUp, signIn, signOut, sessionExpired, expireSession }}>
            {children}
            <SessionExpiredModal show={sessionExpired} onSignIn={acknowledgeExpiry} />
        </UserContext.Provider>
    );
};
