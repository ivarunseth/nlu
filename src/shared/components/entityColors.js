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

// WCAG relative luminance: sRGB channels are gamma-decoded before they are
// weighted. Skipping that decode (as the simpler YIQ brightness formula does)
// understates how light saturated mid-tones actually read, which is what put
// white text on colours like #ca8a04 that cannot carry it.
const relativeLuminance = (r, g, b) => {
    const [red, green, blue] = [r, g, b]
        .map((channel) => channel / 255)
        .map((channel) => (
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

// Black or white text, whichever genuinely contrasts better against a solid
// `hex` background, so tagged text stays legible on every palette colour. The
// choice is measured rather than thresholded — for a binary choice the higher
// contrast ratio is by definition the best available one, and across the
// current palette it clears WCAG AA (4.5:1) on all 64 colours.
//
// It is also theme-independent, and deliberately so: the background here is the
// entity's own colour, which does not change between light and dark, so the
// text on it must not either.
export const readableTextColor = (hex) => {
    if (!hex) return "#fff";
    // Trimmed because a stored colour may carry surrounding whitespace: CSS
    // tolerates it, so the background still paints, and an untrimmed value
    // would silently fail the length check below and fall through to white.
    const raw = String(hex).trim().replace("#", "");
    const full =
        raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    if (full.length !== 6) return "#fff";

    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return "#fff";

    // Contrast ratio per WCAG: (lighter + 0.05) / (darker + 0.05).
    const luminance = relativeLuminance(r, g, b);
    const withWhite = 1.05 / (luminance + 0.05);
    const withBlack = (luminance + 0.05) / 0.05;
    return withBlack > withWhite ? "#000" : "#fff";
};