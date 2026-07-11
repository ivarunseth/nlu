// Load the palette from /colors.txt in the public folder.
// The file should contain one hex color per line.
export let COLORS = [];

const palettePromise = fetch("/colors.txt")
    .then((res) => {
        if (!res.ok) {
            throw new Error(`Failed to load colors.txt (${res.status})`);
        }
        return res.text();
    })
    .then((text) => {
        COLORS = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    })
    .catch((err) => {
        console.error("Failed to load entity palette:", err);
        COLORS = [];
    });

// Consumers that need to guarantee the palette is loaded can await this.
export const entityPaletteReady = palettePromise;

// A deterministic palette colour for an entity name (djb2-style hash), so the
// same entity always highlights in the same colour within a session.
export const entityColor = (name) => {
    if (COLORS.length === 0) return "#3b82f6";

    let hash = 0;
    for (let i = 0; i < (name || "").length; i += 1) {
        hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return COLORS[Math.abs(hash) % COLORS.length];
};

// The first palette colour not already used by an entity, so a fresh entity
// gets a colour distinct from every existing one. Falls back to cycling the
// palette once every colour is in use.
export const nextEntityColor = (usedColors = []) => {
    if (COLORS.length === 0) return "#3b82f6";

    const used = new Set(
        usedColors.filter(Boolean).map((color) => color.toLowerCase())
    );
    const free = COLORS.find(
        (color) => !used.has(color.toLowerCase())
    );
    return free || COLORS[used.size % COLORS.length];
};

// Black or white text, whichever reads better on a solid `hex` background, so
// entity chips stay legible in both light and dark themes regardless of the
// entity's colour (a bright yellow gets black text, a deep blue gets white).
export const readableTextColor = (hex) => {
    if (!hex) return "#fff";
    const raw = hex.replace("#", "");
    const full =
        raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    if (full.length !== 6) return "#fff";

    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);

    // Perceptual luminance (sRGB weights); bright colours cross the threshold.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#000" : "#fff";
};