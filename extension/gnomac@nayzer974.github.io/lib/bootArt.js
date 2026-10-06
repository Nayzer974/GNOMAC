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

const APPLE_PATH = 'M78.58 33.99C77.9 34.56 75.73 36.16 74.49 37.44C73.25 38.71 72.05 40.11 71.12 41.62C70.18 43.13 69.41 44.81 68.87 46.5C68.33 48.19 67.99 49.96 67.88 51.78C67.77 53.59 67.9 55.59 68.24 57.37C68.57 59.15 69.14 60.87 69.9 62.48C70.65 64.08 71.65 65.63 72.78 67.01C73.91 68.38 75.26 69.64 76.67 70.73C78.07 71.82 80.46 73.07 81.22 73.54C80.92 74.35 80.13 76.8 79.46 78.38C78.79 79.96 78.04 81.51 77.22 83.02C76.4 84.52 75.51 85.95 74.54 87.42C73.57 88.88 72.48 90.41 71.39 91.79C70.29 93.16 69.25 94.52 67.99 95.66C66.73 96.81 65.35 97.95 63.82 98.66C62.3 99.36 60.53 99.83 58.86 99.88C57.19 99.93 55.46 99.43 53.82 98.95C52.18 98.47 50.67 97.52 49.04 97.01C47.41 96.5 45.76 96.03 44.03 95.9C42.3 95.77 40.38 95.92 38.67 96.25C36.97 96.58 35.41 97.32 33.79 97.88C32.17 98.44 30.6 99.3 28.95 99.61C27.29 99.92 25.47 100.08 23.86 99.74C22.24 99.39 20.63 98.5 19.24 97.54C17.85 96.58 16.69 95.24 15.53 93.97C14.38 92.71 13.35 91.32 12.32 89.95C11.28 88.57 10.28 87.22 9.34 85.74C8.4 84.26 7.47 82.61 6.67 81.05C5.88 79.49 5.19 77.95 4.54 76.36C3.9 74.77 3.31 73.15 2.79 71.52C2.27 69.88 1.8 68.22 1.42 66.55C1.03 64.88 0.71 63.19 0.47 61.49C0.23 59.8 0.06 58.09 0 56.38C-0.06 54.67 -0.03 52.97 0.1 51.23C0.24 49.48 0.45 47.62 0.81 45.91C1.17 44.2 1.63 42.56 2.25 40.96C2.87 39.37 3.63 37.8 4.53 36.35C5.43 34.89 6.47 33.49 7.63 32.23C8.79 30.98 10.1 29.81 11.49 28.83C12.88 27.84 14.42 26.99 15.99 26.33C17.56 25.66 19.24 25.16 20.91 24.85C22.59 24.55 24.31 24.37 26.04 24.5C27.77 24.63 29.61 25.14 31.29 25.63C32.97 26.12 34.48 26.93 36.11 27.46C37.73 28 39.4 28.82 41.05 28.84C42.7 28.86 44.39 28.11 46.02 27.6C47.66 27.08 49.21 26.28 50.84 25.76C52.48 25.24 54.13 24.73 55.82 24.48C57.51 24.23 59.22 24.14 60.96 24.27C62.7 24.39 64.57 24.74 66.24 25.22C67.92 25.7 69.52 26.34 71.01 27.15C72.51 27.97 73.96 28.97 75.22 30.11C76.48 31.25 78.02 33.34 78.58 33.99ZM60.25 0.03C60.25 0.94 60.57 3.69 60.26 5.53C59.94 7.37 59.2 9.36 58.39 11.07C57.57 12.78 56.55 14.38 55.36 15.8C54.16 17.22 52.78 18.53 51.22 19.6C49.67 20.67 47.79 21.69 46 22.22C44.22 22.75 41.42 22.69 40.5 22.78C40.54 21.85 40.4 18.98 40.76 17.21C41.12 15.44 41.82 13.79 42.66 12.17C43.5 10.56 44.59 8.92 45.82 7.52C47.05 6.13 48.54 4.85 50.04 3.81C51.53 2.78 53.1 1.92 54.8 1.29C56.5 0.66 59.34 0.24 60.25 0.03Z';

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
export function paintLogo(cr, width, height, {stroke = 1, fill = 1, sheen = -1, reflect = 1} = {}) {
    const {subpaths, box} = appleShape();
    const logoHeight = box.maxY - box.minY;
    const logoWidth = box.maxX - box.minX;
    // The logo takes the upper part of the square, its reflection the rest.
    const size = Math.min(width, height) * 0.7;
    const scale = Math.min(size / logoHeight, (width * 0.8) / logoWidth);
    const total = logoHeight * scale * 1.34;
    const ox = (width - logoWidth * scale) / 2 - box.minX * scale;
    const oy = (height - total) / 2 - box.minY * scale;
    cr.save();
    cr.translate(ox, oy);
    cr.scale(scale, scale);

    const path = () => tracePath(cr, subpaths);
    const bodyGradient = () => gradient(0, box.minY, 0, box.maxY, [
        [0, 1, 1, 1, 1], [0.55, 0.93, 0.94, 0.97, 1], [1, 0.73, 0.76, 0.84, 1],
    ]);

    // Glass body.
    if (fill > 0) {
        path();
        const body = bodyGradient();
        cr.setSource(body);
        cr.fillPreserve();
        if (sheen >= 0 && sheen <= 1) {
            cr.save();
            cr.clip();
            const x = box.minX - logoWidth * 0.4 + sheen * logoWidth * 1.8;
            cr.setSource(gradient(x - logoWidth * 0.25, box.minY, x + logoWidth * 0.25, box.maxY, [
                [0, 1, 1, 1, 0], [0.5, 1, 1, 1, 0.75 * fill], [1, 1, 1, 1, 0],
            ]));
            cr.paint();
            cr.restore();
        } else {
            cr.newPath();
        }

        // The soft reflection below: the same shape, mirrored, fading out.
        if (reflect > 0) {
            const gap = logoHeight * 0.015;
            const reach = logoHeight * 0.3;
            cr.save();
            cr.pushGroup();
            cr.translate(0, 2 * box.maxY + gap);
            cr.scale(1, -1);
            path();
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.fill();
            cr.popGroupToSource();
            const fade = new Cairo.LinearGradient(0, box.maxY + gap, 0, box.maxY + gap + reach);
            fade.addColorStopRGBA(0, 1, 1, 1, 0.36 * fill * reflect);
            fade.addColorStopRGBA(0.5, 1, 1, 1, 0.10 * fill * reflect);
            fade.addColorStopRGBA(1, 1, 1, 1, 0);
            cr.mask(fade);
            cr.restore();
        }
    }

    // The outline being traced: a soft glow under a thin bright line.
    if (stroke > 0 && stroke < 1.001) {
        const unit = 0.5;
        for (const [lineWidth, alpha] of [[unit * 5, 0.10], [unit * 2.4, 0.22], [unit, 0.95]]) {
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
