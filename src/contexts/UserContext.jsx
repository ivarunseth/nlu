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
