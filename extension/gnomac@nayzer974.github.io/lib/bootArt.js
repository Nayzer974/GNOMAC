// The drawings of the start-up animation, as in macOS 26/27 "Hello":
//  - the logo is traced with a line, then fills with glass and a sheen sweeps
//    across it,
//  - greeting words are written stroke by stroke in a script, in glass.
//
// Both are Cairo drawings repainted every frame from a few numbers, so the
// animation is just those numbers changing over time.

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';

import {parsePath, tracePath} from './svgPath.js';
import {HELLO_WORDS} from './helloPaths.js';

const APPLE_PATH = 'M10.9 1.1c.05.75-.22 1.5-.69 2.05-.48.56-1.2.98-1.93.92-.08-.73.27-1.5.72-2 .5-.56 1.3-.97 1.9-.97zM13.4 11.2c-.36.83-.53 1.2-1 1.94-.65 1.02-1.57 2.29-2.7 2.3-1.02.01-1.28-.66-2.66-.66-1.38.01-1.67.67-2.69.66-1.14-.01-2-1.16-2.66-2.18C-.13 10.4-.32 7.14.79 5.43 1.58 4.2 2.82 3.49 3.99 3.49c1.2 0 1.94.66 2.93.66.96 0 1.54-.66 2.92-.66 1.04 0 2.14.57 2.93 1.55-2.57 1.41-2.15 5.08.63 6.16z';

export const clamp01 = v => Math.min(1, Math.max(0, v));
export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
export const easeOut = t => 1 - (1 - t) ** 3;

let apple = null;
const appleShape = () => (apple ??= parsePath(APPLE_PATH));
const wordShapes = new Map();

function wordShape(key) {
    if (!wordShapes.has(key)) {
        const word = HELLO_WORDS[key];
        wordShapes.set(key, {...parsePath(word.d), text: word.text});
    }
    return wordShapes.get(key);
}

export const WORD_KEYS = Object.keys(HELLO_WORDS);

// Greetings for the user's language first, then a few others.
export function greetingOrder(count) {
    const locale = (GLib.get_language_names()[0] ?? 'en').slice(0, 2);
    const first = {fr: 'fr', es: 'es', de: 'de', it: 'it', pt: 'pt', sv: 'sv'}[locale] ?? 'en';
    const rest = ['en', 'fr', 'es', 'de', 'it', 'pt', 'sv', 'fr2'].filter(k => k !== first);
    return [first, ...rest].slice(0, Math.max(1, count));
}

function gradient(x0, y0, x1, y1, stops) {
    const g = new Cairo.LinearGradient(x0, y0, x1, y1);
    for (const [offset, r, gr, b, a] of stops)
        g.addColorStopRGBA(offset, r, gr, b, a);
    return g;
}

// ------------------------------------------------------------------- logo

// stroke: 0..1 how much of the outline is drawn; fill: 0..1 glass opacity;
// sheen: 0..1 position of the light band (outside 0..1 = none).
export function paintLogo(cr, width, height, {stroke = 1, fill = 1, sheen = -1} = {}) {
    const {subpaths, box} = appleShape();
    const size = Math.min(width, height) * 0.82;
    const scale = size / Math.max(box.maxX - box.minX, box.maxY - box.minY);
    const ox = (width - (box.maxX - box.minX) * scale) / 2 - box.minX * scale;
    const oy = (height - (box.maxY - box.minY) * scale) / 2 - box.minY * scale;
    cr.save();
    cr.translate(ox, oy);
    cr.scale(scale, scale);

    // Glass body.
    if (fill > 0) {
        tracePath(cr, subpaths);
        cr.setSource(gradient(0, box.minY, 0, box.maxY, [
            [0, 1, 1, 1, 0.97 * fill], [0.55, 0.93, 0.94, 0.97, 0.93 * fill], [1, 0.72, 0.76, 0.85, 0.9 * fill],
        ]));
        cr.fillPreserve();
        if (sheen >= 0 && sheen <= 1) {
            cr.save();
            cr.clip();
            const w = box.maxX - box.minX;
            const x = box.minX - w * 0.4 + sheen * w * 1.8;
            cr.setSource(gradient(x - w * 0.25, box.minY, x + w * 0.25, box.maxY, [
                [0, 1, 1, 1, 0], [0.5, 1, 1, 1, 0.75 * fill], [1, 1, 1, 1, 0],
            ]));
            cr.paint();
            cr.restore();
        } else {
            cr.newPath();
        }
    }

    // The outline being traced: a soft glow under a thin bright line.
    if (stroke > 0 && stroke < 1.001) {
        const width1 = 0.16 / 1;
        for (const [lineWidth, alpha] of [[width1 * 5, 0.10], [width1 * 2.4, 0.22], [width1, 0.95]]) {
            cr.setLineWidth(lineWidth);
            cr.setLineJoin(1);
            cr.setLineCap(1);
            cr.setSourceRGBA(1, 1, 1, alpha * (1 - 0.6 * fill));
            for (const sub of subpaths) {
                tracePath(cr, [sub]);
                cr.setDash([sub.length * stroke, sub.length * 2 + 4], 0);
                cr.stroke();
            }
        }
    }
    cr.restore();
}

// ------------------------------------------------------------------ words

// write: 0..1 the pen's progress (left to right, contour by contour);
// fill: 0..1 how much of the glass body has filled in.
export function paintWord(cr, width, height, key, {write = 1, fill = 1, alpha = 1} = {}) {
    const word = wordShape(key);
    const {subpaths, box} = word;
    const wordWidth = box.maxX - box.minX;
    const scale = Math.min(width * 0.9 / wordWidth, height * 0.85 / 1000);
    const ox = (width - wordWidth * scale) / 2 - box.minX * scale;
    const oy = height * 0.62;
    cr.save();
    cr.translate(ox, oy);
    cr.scale(scale, scale);

    const edge = 1.6 / scale;
    const top = box.minY;
    const bottom = Math.max(0, box.maxY);

    // The glass body, once the writing is done.
    if (fill > 0) {
        tracePath(cr, subpaths);
        cr.setSource(gradient(0, top, 0, bottom, [
            [0, 0.80, 0.95, 1, 0.96 * fill * alpha], [0.5, 0.45, 0.78, 1, 0.9 * fill * alpha],
            [1, 0.16, 0.42, 0.96, 0.92 * fill * alpha],
        ]));
        cr.fill();
    }

    // The pen: every contour is traced by its own progress, from the left.
    if (write < 1.001) {
        for (const [lineWidth, a] of [[edge * 7, 0.10], [edge * 3, 0.24], [edge * 1.2, 0.95]]) {
            cr.setLineWidth(lineWidth);
            cr.setLineJoin(1);
            cr.setLineCap(1);
            cr.setSourceRGBA(0.85, 0.96, 1, a * alpha * (1 - 0.7 * fill));
            for (const sub of subpaths) {
                const start = clamp01(((sub.minX - box.minX) / wordWidth)) * 0.62;
                const p = clamp01((write - start) / 0.38);
                if (p <= 0)
                    continue;
                tracePath(cr, [sub]);
                cr.setDash([sub.length * p, sub.length * 2 + 4], 0);
                cr.stroke();
            }
        }
    }

    // Edge light of the glass.
    if (fill > 0.3) {
        cr.setLineWidth(edge);
        cr.setDash([], 0);
        cr.setSourceRGBA(1, 1, 1, 0.8 * fill * alpha);
        tracePath(cr, subpaths);
        cr.stroke();
    }
    cr.restore();
}
