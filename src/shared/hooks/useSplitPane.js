import { useEffect, useRef, useState } from "react";

// A draggable horizontal split between two panels, expressed as the left
// panel's width percentage. The split (and its gutter) only apply from the lg
// breakpoint up, where the panels sit side by side; below it they stack full
// width. Shared by the annotation-style Build layouts — the NER
// entities/utterances split and the language understanding slots/utterances
// split — so both resize identically. Mirrors the Test page's request/response
// drag handle (same mechanics and gutter).
export default function useSplitPane({ initial = 34, min = 22, max = 55 } = {}) {
    const [splitPct, setSplitPct] = useState(initial);
    const [isWide, setIsWide] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(min-width: 992px)").matches
    );
    const splitRef = useRef(null);
    const draggingRef = useRef(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(min-width: 992px)");
        const handleChange = (event) => setIsWide(event.matches);
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        const handleMove = (event) => {
            if (!draggingRef.current || !splitRef.current) return;
            const rect = splitRef.current.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const pct = ((clientX - rect.left) / rect.width) * 100;
            setSplitPct(Math.min(max, Math.max(min, pct)));
        };
        const stopDrag = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", stopDrag);
        window.addEventListener("touchmove", handleMove, { passive: false });
        window.addEventListener("touchend", stopDrag);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", stopDrag);
            window.removeEventListener("touchmove", handleMove);
            window.removeEventListener("touchend", stopDrag);
        };
    }, [min, max]);

    const startDrag = (event) => {
        draggingRef.current = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        event.preventDefault();
    };

    const resetSplit = () => setSplitPct(initial);

    return { splitPct, isWide, splitRef, startDrag, resetSplit };
}
