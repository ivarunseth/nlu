import downloadBlob from "./downloadBlob";

// Rasterize a recharts SVG to a PNG download. Inlines the theme-dependent
// styles recharts gets from CSS so the exported image matches the screen.
const chartPng = (svg, filename, scale = 2) => {
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
