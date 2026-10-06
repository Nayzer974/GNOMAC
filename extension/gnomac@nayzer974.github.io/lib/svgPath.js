// A small SVG path reader for Cairo: absolute and relative M L H V C S Q T Z,
// curves flattened only to measure lengths. A parsed path is a list of
// subpaths (the contours), each with its own length and horizontal extent,
// so a drawing animation can trace every contour by its own dash progress.

const TOKENS = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

function cubicPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
}

export function parsePath(d) {
    const tokens = d.match(TOKENS) ?? [];
    const subpaths = [];
    let current = null;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let lastControl = null; // [x, y, kind] for S and T reflections
    let command = '';
    let i = 0;

    const number = () => Number(tokens[i++]);
    const begin = (px, py) => {
        current = {cmds: [['M', px, py]], length: 0, minX: px, maxX: px, minY: py, maxY: py, closed: false};
        subpaths.push(current);
        startX = px;
        startY = py;
    };
    const grow = (px, py) => {
        current.minX = Math.min(current.minX, px);
        current.maxX = Math.max(current.maxX, px);
        current.minY = Math.min(current.minY, py);
        current.maxY = Math.max(current.maxY, py);
    };
    const line = (px, py) => {
        current.length += Math.hypot(px - x, py - y);
        current.cmds.push(['L', px, py]);
        grow(px, py);
        x = px;
        y = py;
    };
    const cubic = (x1, y1, x2, y2, px, py) => {
        const p0 = [x, y];
        let last = p0;
        for (let s = 1; s <= 12; s++) {
            const q = cubicPoint(p0, [x1, y1], [x2, y2], [px, py], s / 12);
            current.length += Math.hypot(q[0] - last[0], q[1] - last[1]);
            last = q;
        }
        current.cmds.push(['C', x1, y1, x2, y2, px, py]);
        for (const [cx, cy] of [[x1, y1], [x2, y2], [px, py]])
            grow(cx, cy);
        lastControl = [x2, y2, 'C'];
        x = px;
        y = py;
    };
    const quad = (qx, qy, px, py) => {
        // A quadratic curve is the cubic with its control points two thirds along.
        cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y),
            px + 2 / 3 * (qx - px), py + 2 / 3 * (qy - py), px, py);
        lastControl = [qx, qy, 'Q'];
    };

    while (i < tokens.length) {
        if (/[a-zA-Z]/.test(tokens[i]))
            command = tokens[i++];
        else if (command === 'M')
            command = 'L';
        else if (command === 'm')
            command = 'l';
        const rel = command === command.toLowerCase();
        const dx = rel ? x : 0;
        const dy = rel ? y : 0;
        switch (command.toUpperCase()) {
        case 'M': {
            const px = number() + dx;
            const py = number() + dy;
            x = px;
            y = py;
            begin(px, py);
            lastControl = null;
            break;
        }
        case 'L':
            line(number() + dx, number() + dy);
            lastControl = null;
            break;
        case 'H':
            line(number() + (rel ? x : 0), y);
            lastControl = null;
            break;
        case 'V':
            line(x, number() + (rel ? y : 0));
            lastControl = null;
            break;
        case 'C': {
            const x1 = number() + dx;
            const y1 = number() + dy;
            const x2 = number() + dx;
            const y2 = number() + dy;
            cubic(x1, y1, x2, y2, number() + dx, number() + dy);
            break;
        }
        case 'S': {
            const [rx, ry] = lastControl && lastControl[2] === 'C'
                ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
            const x2 = number() + dx;
            const y2 = number() + dy;
            cubic(rx, ry, x2, y2, number() + dx, number() + dy);
            break;
        }
        case 'Q': {
            const qx = number() + dx;
            const qy = number() + dy;
            quad(qx, qy, number() + dx, number() + dy);
            break;
        }
        case 'T': {
            const [rx, ry] = lastControl && lastControl[2] === 'Q'
                ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
            quad(rx, ry, number() + dx, number() + dy);
            break;
        }
        case 'Z':
            if (current) {
                current.length += Math.hypot(startX - x, startY - y);
                current.cmds.push(['Z']);
                current.closed = true;
                x = startX;
                y = startY;
            }
            lastControl = null;
            break;
        default:
            // Unknown command: skip it rather than loop forever.
            i++;
        }
    }

    const box = subpaths.reduce((b, s) => ({
        minX: Math.min(b.minX, s.minX), maxX: Math.max(b.maxX, s.maxX),
        minY: Math.min(b.minY, s.minY), maxY: Math.max(b.maxY, s.maxY),
    }), {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity});
    return {subpaths, box};
}

// Add the subpaths to the Cairo context's current path, in the context's
// current transform (the caller scales and translates).
export function tracePath(cr, subpaths) {
    for (const sub of subpaths) {
        for (const cmd of sub.cmds) {
            switch (cmd[0]) {
            case 'M': cr.moveTo(cmd[1], cmd[2]); break;
            case 'L': cr.lineTo(cmd[1], cmd[2]); break;
            case 'C': cr.curveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]); break;
            case 'Z': cr.closePath(); break;
            }
        }
    }
}
