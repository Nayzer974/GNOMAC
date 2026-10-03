// Spring physics shared by every GNOMAC animation.
//
// macOS animations are springs, not fixed-duration easings: they keep their
// velocity when retargeted mid-flight, which is what makes the dock and
// windows feel "alive". A single frame ticker drives every active spring so
// we never run more than one timeline.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const MAX_SUBSTEP = 1 / 240;

export class Spring {
    constructor({stiffness = 260, damping = 26, mass = 1, value = 0, epsilon = 0.0015} = {}) {
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this.epsilon = epsilon;
    }

    setTarget(target) {
        this.target = target;
    }

    snap(value) {
        this.value = this.target = value;
        this.velocity = 0;
    }

    get settled() {
        return Math.abs(this.value - this.target) < this.epsilon &&
            Math.abs(this.velocity) < this.epsilon;
    }

    step(dt) {
        if (this.settled) {
            this.value = this.target;
            this.velocity = 0;
            return;
        }
        // Semi-implicit Euler with fixed substeps: stable at any frame rate.
        const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
            const force = -this.stiffness * (this.value - this.target) -
                this.damping * this.velocity;
            this.velocity += (force / this.mass) * h;
            this.value += this.velocity * h;
        }
    }
}

// One timeline for the whole extension. Callbacks receive dt in seconds and
// return true to keep ticking.
class Ticker {
    constructor() {
        this._callbacks = new Set();
        this._timeline = null;
        this._last = 0;
    }

    add(callback) {
        this._callbacks.add(callback);
        if (this._timeline)
            return;
        this._timeline = new Clutter.Timeline({
            actor: global.stage,
            duration: 1000,
            repeat_count: -1,
        });
        this._last = GLib.get_monotonic_time();
        this._timeline.connect('new-frame', () => this._onFrame());
        this._timeline.start();
    }

    remove(callback) {
        this._callbacks.delete(callback);
        if (this._callbacks.size === 0)
            this._stop();
    }

    _onFrame() {
        const now = GLib.get_monotonic_time();
        // Clamp so a stalled frame never makes a spring explode.
        const dt = Math.min((now - this._last) / 1e6, 1 / 20);
        this._last = now;
        for (const callback of [...this._callbacks]) {
            let keep = false;
            try {
                keep = callback(dt);
            } catch (e) {
                logError(e, 'GNOMAC ticker');
            }
            if (!keep)
                this._callbacks.delete(callback);
        }
        if (this._callbacks.size === 0)
            this._stop();
    }

    _stop() {
        if (!this._timeline)
            return;
        this._timeline.stop();
        this._timeline = null;
    }

    destroy() {
        this._callbacks.clear();
        this._stop();
    }
}

let _ticker = null;

export function getTicker() {
    if (!_ticker)
        _ticker = new Ticker();
    return _ticker;
}

export function destroyTicker() {
    _ticker?.destroy();
    _ticker = null;
}
