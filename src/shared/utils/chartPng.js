import downloadBlob from "./downloadBlob";

// Vite rewrites this to the hashed asset URL at build time, so the export path
// never has to guess where the font landed. Latin only: chart text is versions,
// dates, counts and metric names. An Indic axis label still falls back to the
// platform's own Indic font in the PNG, exactly as it does on screen.
import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

// An SVG loaded through a blob URL renders in its own document with no access
// to the page's stylesheets, so the @font-face backing 'Inter Variable' does
// not exist there — chart text would silently fall back to a system font while
// the chart on screen used Inter. Inlining the face as a data URI is what keeps
// the exported image matching the screen.
//
// Cached because the base64 payload is ~64KB and a user may export several
// charts in one sitting; resolved once, reused thereafter.
let fontFacePromise = null;

const embeddedFontFace = () => {
    if (!fontFacePromise) {
        fontFacePromise = fetch(interWoff2)
            .then((response) => {
                if (!response.ok) throw new Error(`font fetch failed: ${response.status}`);
                return response.arrayBuffer();
            })
            .then((buffer) => {
                const bytes = new Uint8Array(buffer);
                // Chunked rather than String.fromCharCode(...bytes): spreading
                // ~48K arguments overflows the call stack in some browsers.
                let binary = "";
                for (let i = 0; i < bytes.length; i += 8192) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
                }
                return "@font-face{font-family:'Inter Variable';font-style:normal;"
                    + "font-weight:100 900;src:url(data:font/woff2;base64,"
                    + `${btoa(binary)}) format('woff2');}`;
            })
            // A missing font must never cost the user their export: fall through
            // and let the serialized stack pick a system face, as it did before.
            .catch(() => null);
    }
    return fontFacePromise;
};

// Rasterize a recharts SVG to a PNG download. Inlines the theme-dependent
// styles recharts gets from CSS, and the webfont it gets from the document, so
// the exported image matches the screen.
const chartPng = async (svg, filename, scale = 2) => {
    if (!svg) return;
    const clone = svg.cloneNode(true);
    const sourceNodes = [svg, ...svg.querySelectorAll('*')];
    const cloneNodes = [clone, ...clone.querySelectorAll('*')];
    sourceNodes.forEach((node, i) => {
        const style = getComputedStyle(node);
        if (style.stroke !== 'none') cloneNodes[i].setAttribute('stroke', style.stroke);
        if (style.fill !== 'none') cloneNodes[i].setAttribute('fill', style.fill);
        if (node.tagName === 'text') {
            cloneNodes[i].setAttribute('font-size', style.fontSize);
            cloneNodes[i].setAttribute('font-family', style.fontFamily);
            cloneNodes[i].setAttribute('font-weight', style.fontWeight);
        }
    });

    const fontFace = await embeddedFontFace();
    if (fontFace) {
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = fontFace;
        clone.insertBefore(style, clone.firstChild);
    }

    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = svg.clientWidth * scale;
        canvas.height = svg.clientHeight * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => blob && downloadBlob(blob, filename));
    };
    image.src = url;
};

export default chartPng;
