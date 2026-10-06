// macOS Genie: the window is sucked into its dock icon through a narrowing
// funnel. Same model as RevoShell's Genie.qml: the window snapshot is cut
// into horizontal strips; rows nearest the dock leave first (smootherstep
// timing) and each strip is moved and squeezed towards the icon.
//
// Strips instead of a Clutter.DeformEffect mesh on purpose: DeformEffect
// renders nothing at all with software rendering (VMs, llvmpipe), which
// would make windows vanish mid-animation. Clipped, scaled actors that share
// one texture work on every renderer.

import Clutter from 'gi://Clutter';

const STRIPS = 110;

function smootherstep(u) {
    if (u <= 0)
        return 0;
    if (u >= 1)
        return 1;
    return u * u * u * (u * (u * 6 - 15) + 10);
}

export class Genie {
    // content: Clutter.Content of the window; rect: its stage rectangle;
    // tip: {x, y, half} of the dock icon slot in stage coordinates.
    constructor(parent, content, rect, tip) {
        this._rect = rect;
        this._tip = tip;
        this.actor = new Clutter.Actor({x: rect.x, y: rect.y, reactive: false});
        parent.add_child(this.actor);

        const stripHeight = rect.height / STRIPS;
        this._strips = [];
        for (let i = 0; i < STRIPS; i++) {
            const y0 = i * stripHeight;
            const strip = new Clutter.Actor({
                content,
                width: rect.width,
                height: rect.height,
            });
            // Overlap by a pixel so no seam shows between strips.
            strip.set_clip(0, y0, rect.width, stripHeight + 1);
            strip.set_pivot_point(0, y0 / rect.height);
            this.actor.add_child(strip);
            this._strips.push({strip, v0: i / STRIPS, v1: (i + 1) / STRIPS, y0});
        }
        this.setProgress(0);
    }

    // Rows closer to the icon leave first; the far edge arrives last.
    _k(v, progress) {
        const iconBelow = this._tip.y >= this._rect.y + this._rect.height / 2;
        const lead = iconBelow ? 1 - v : v;
        return smootherstep((progress - 0.45 * lead) / 0.55);
    }

    _row(v, progress) {
        const {width, height} = this._rect;
        const tipX = this._tip.x - this._rect.x;
        const tipY = this._tip.y - this._rect.y;
        const k = this._k(v, progress);
        const y0 = v * height;
        return {
            y: y0 + (tipY - y0) * k,
            centre: width / 2 + (tipX - width / 2) * k,
            half: width / 2 + (this._tip.half - width / 2) * k,
        };
    }

    setProgress(progress) {
        const {width, height} = this._rect;
        const stripHeight = height / STRIPS;
        for (const {strip, v0, v1, y0} of this._strips) {
            const top = this._row(v0, progress);
            const bottom = this._row(v1, progress);
            const half = (top.half + bottom.half) / 2;
            const centre = (top.centre + bottom.centre) / 2;
            strip.set_scale(Math.max(0.001, (2 * half) / width),
                Math.max(0.001, (bottom.y - top.y) / stripHeight));
            strip.set_position(centre - half, top.y - y0);
        }
        // Fade the last stretch so the window melts into the icon.
        this.actor.opacity = Math.round(255 * Math.min(1, (1 - progress) * 4));
    }

    destroy() {
        this.actor.destroy();
    }
}
