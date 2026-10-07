// AnimationTimeline: every time-based animation of the desktop motion system
// runs on the ONE metronome of the extension (lib/spring.js getTicker()), not
// on a timer or Clutter.Timeline of its own.
//
//   const run = timelines.run({duration: 420, easing: Easing.smooth,
//       onFrame: (progress, raw) => ..., onDone: () => ...});
//   run.cancel();                       // stops it where it is, no onDone
//   run.then(() => timelines.run(...)); // chaining: starts when this one ends
//
// `progress` is the eased value, `raw` the linear time (0..1). Time comes from
// the monotonic clock, so a stalled frame does not slow the animation down.
// A duration of 0 (reduced motion) calls onFrame(1, 1) and onDone at once.

import GLib from 'gi://GLib';

import {getTicker} from './spring.js';
import {Easing} from './motionTokens.js';

class Run {
    constructor(manager, options) {
        this._manager = manager;
        this.duration = Math.max(0, options.duration ?? 0);
        this.delay = options.delay ?? 0;
        this.easing = options.easing ?? Easing.easeOut;
        this.onFrame = options.onFrame ?? null;
        this.onDone = options.onDone ?? null;
        this.start = GLib.get_monotonic_time();
        this.finished = false;
        this.cancelled = false;
        this._next = [];
    }

    get progress() {
        const raw = this.duration ? (GLib.get_monotonic_time() - this.start) / 1000 - this.delay : 1;
        return Math.min(1, Math.max(0, raw / (this.duration || 1)));
    }

    cancel() {
        this.cancelled = true;
        this.finished = true;
        this._manager._runs.delete(this);
    }

    // Runs `callback` when this one ends (it may return another Run).
    then(callback) {
        if (this.finished && !this.cancelled)
            callback();
        else if (!this.finished)
            this._next.push(callback);
        return this;
    }

    _finish() {
        this.finished = true;
        this.onDone?.();
        for (const next of this._next)
            next();
    }
}

class TimelineManager {
    constructor() {
        this._runs = new Set();
        this._tick = () => this._onTick();
    }

    get active() {
        return this._runs.size;
    }

    run(options) {
        const run = new Run(this, options);
        if (!run.duration) {
            run.onFrame?.(1, 1);
            run._finish();
            return run;
        }
        this._runs.add(run);
        getTicker().add(this._tick);
        return run;
    }

    // Stops everything (the extension is being disabled).
    cancelAll() {
        for (const run of [...this._runs])
            run.cancel();
        getTicker().remove(this._tick);
    }

    _onTick() {
        for (const run of [...this._runs]) {
            if (run.cancelled)
                continue;
            const raw = run.progress;
            try {
                run.onFrame?.(run.easing(raw), raw);
            } catch (e) {
                logError(e, 'GNOMAC animation');
                run.cancel();
                continue;
            }
            if (raw >= 1) {
                this._runs.delete(run);
                try {
                    run._finish();
                } catch (e) {
                    logError(e, 'GNOMAC animation end');
                }
            }
        }
        return this._runs.size > 0;
    }
}

export const timelines = new TimelineManager();
