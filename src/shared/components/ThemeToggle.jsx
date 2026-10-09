import { Button } from "react-bootstrap";
import { MoonStars, Sun } from "react-bootstrap-icons";
import { useTheme } from "../../contexts/ThemeContext";

const ThemeToggle = ({ className = "" }) => {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";

    return (
        <Button
            variant="link"
            onClick={toggleTheme}
            className={`text-body d-inline-flex align-items-center px-2 ${className}`}
            aria-label={label}
            title={label}
        >
            {isDark ? <Sun size={17} /> : <MoonStars size={17} />}
        </Button>
    );
};

export default ThemeToggle;
