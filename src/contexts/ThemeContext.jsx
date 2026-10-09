import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Themes are applied through Bootstrap 5.3 color modes: the active theme name
// is written to the data-bs-theme attribute on <html>. Adding a new theme only
// requires appending it here and defining its variables in index.css.
export const THEMES = ["light", "dark"];

const STORAGE_KEY = "theme";

const systemTheme = () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

// Also used by the inline script in index.html to set the theme before first
// paint; keep the two in sync.
export const getInitialTheme = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : systemTheme();
};

export const ThemeContext = createContext({
    theme: "light",
    setTheme: () => {},
    toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(getInitialTheme);

    useEffect(() => {
        document.documentElement.setAttribute("data-bs-theme", theme);
    }, [theme]);

    // Follow OS-level theme changes until the user makes an explicit choice.
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => {
            if (!localStorage.getItem(STORAGE_KEY)) {
                setThemeState(systemTheme());
            }
        };
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
    }, []);

    const setTheme = useCallback((next) => {
        if (!THEMES.includes(next)) return;
        localStorage.setItem(STORAGE_KEY, next);
        setThemeState(next);
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeState((current) => {
            const next = current === "dark" ? "light" : "dark";
            localStorage.setItem(STORAGE_KEY, next);
            return next;
        });
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
