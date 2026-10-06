// macOS window animations: open (quick scale-up + fade), close (shrink +
// fade), minimize and restore with the Genie effect into the dock icon.
//
// GNOME binds its own handlers to the window manager signals at startup, so
// they cannot be replaced. What can be replaced is the one decision they all
// ask: Main.wm._shouldAnimateActor(). Like Burn My Windows, we look at the
// caller in the stack, tell GNOME "don't animate" so it completes the
// operation at once, and run our animation ourselves:
//  - minimize: GNOME hides the window at once, so the Genie runs on a
//    snapshot of it (ClutterActor.paint_to_content()),
//  - restore: same snapshot trick in reverse while the real window waits
//    invisible, then it takes over,
//  - open: the real window is shown, we animate it directly,
//  - close: the same Genie, on a snapshot taken as the window is destroyed
//    (setting `close-animation`: genie, or GNOME's own fade).

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Genie} from '../lib/genie.js';

const OPEN_MS = 260;
const GENIE_MS = 560;
const CLOSE_MS = 460;

const ANIMATED_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
];

function callerOf(stack) {
    for (const name of ['_minimizeWindow', '_unminimizeWindow', '_mapWindow', '_destroyWindow']) {
        if (stack.includes(`${name}@`))
            return name;
    }
    return null;
}

export class WindowAnimations {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._pendingOpen = new Set();
        this._pendingRestore = new Set();
        this._genies = new Set();
        this._timelines = new Set();
        // The last picture of each minimized window, taken while it was still
        // on screen: a window that has just been un-minimized may not have
        // painted its first frame yet, and would fly out of the dock blank.
        this._snapshots = new WeakMap();
    }

    enable() {
        const wm = Main.wm;
        this._original = wm._shouldAnimateActor;
        const original = this._original;
        const self = this;
        wm._shouldAnimateActor = function (actor, types) {
            const allowed = original.call(this, actor, types);
            if (!allowed)
                return false;
            const caller = callerOf(new Error().stack ?? '');
            if (!caller || !ANIMATED_TYPES.includes(actor.meta_window?.get_window_type()))
                return allowed;
            try {
                return !self._takeOver(caller, actor);
            } catch (e) {
                logError(e, 'GNOMAC window animations');
                return allowed;
            }
        };

        // Our handlers run after GNOME's, i.e. after it completed the
        // operation, which is when open/restore animations can start.
        this._mapId = global.window_manager.connect('map', (_wm, actor) => this._afterMap(actor));
        this._unminimizeId = global.window_manager.connect('unminimize', (_wm, actor) => this._afterRestore(actor));
    }

    disable() {
        if (this._original) {
            Main.wm._shouldAnimateActor = this._original;
            this._original = null;
        }
        global.window_manager.disconnect(this._mapId);
        global.window_manager.disconnect(this._unminimizeId);
        for (const timeline of this._timelines)
            timeline.stop();
        this._timelines.clear();
        for (const genie of this._genies)
            genie.destroy();
        this._genies.clear();
        this._pendingOpen.clear();
        this._pendingRestore.clear();
    }

    // Returns true when we handle the animation (GNOME must skip its own).
    _takeOver(caller, actor) {
        switch (caller) {
        case '_mapWindow':
            this._pendingOpen.add(actor);
            return true;
        case '_unminimizeWindow':
            this._pendingRestore.add(actor);
            return true;
        case '_minimizeWindow':
            return this._minimize(actor);
        case '_destroyWindow':
            // The snapshot is taken now, while the window still has its last
            // frame; if it cannot be copied GNOME's own animation runs.
            return this._settings.get_string('close-animation') === 'genie' && this._close(actor);
        }
        return false;
    }

    _content(actor) {
        try {
            return actor.paint_to_content(null);
        } catch {
            return null;
        }
    }

    // A new window grows out of its dock icon: the window itself is scaled
    // from the icon's position, so no snapshot is needed (a window that has
    // just been mapped has not painted yet).
    _openFromDock(actor) {
        const target = this._target(actor);
        const width = actor.width || 1;
        const height = actor.height || 1;
        actor.remove_all_transitions();
        actor.set_pivot_point(Math.min(1, Math.max(0, (target.x - actor.x) / width)),
            Math.min(1, Math.max(0, (target.y - actor.y) / height)));
        actor.set_scale(0.06, 0.06);
        actor.opacity = 0;
        actor.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: GENIE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onStopped: () => {
                actor.set_scale(1, 1);
                actor.opacity = 255;
                actor.set_pivot_point(0, 0);
            },
        });
    }

    _afterMap(actor) {
        if (!this._pendingOpen.delete(actor))
            return;
        if (this._settings.get_string('open-animation') === 'dock') {
            try {
                const [ok, rect] = actor.meta_window.get_icon_geometry();
                if (ok && rect.width > 0) {
                    this._openFromDock(actor);
                    return;
                }
            } catch {
                // No icon for this window: the usual pop below.
            }
        }
        // macOS: the window pops in from 90 % with a fast ease-out.
        actor.remove_all_transitions();
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(0.9, 0.9);
        actor.opacity = 0;
        actor.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: OPEN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onStopped: () => {
                actor.set_scale(1, 1);
                actor.opacity = 255;
                actor.set_pivot_point(0, 0);
            },
        });
    }

    // Where the window goes: its dock icon (set by the dock through
    // Meta.Window.set_icon_geometry), else the bottom centre of its monitor.
    _target(actor) {
        const window = actor.meta_window;
        let monitor = Main.layoutManager.primaryMonitor;
        try {
            const [ok, rect] = window.get_icon_geometry();
            if (ok && rect.width > 0)
                return {x: rect.x + rect.width / 2, y: rect.y, half: rect.width / 2};
            monitor = Main.layoutManager.monitors[window.get_monitor()] ?? monitor;
        } catch {
            // The window is already gone: fall back to the primary monitor.
        }
        return {x: monitor.x + monitor.width / 2, y: monitor.y + monitor.height, half: 16};
    }

    _runGenie(actor, content, reverse, onDone, duration = GENIE_MS) {
        const rect = {x: actor.x, y: actor.y, width: actor.width, height: actor.height};
        const genie = new Genie(global.window_group, content, rect, this._target(actor));
        global.window_group.set_child_above_sibling(genie.actor, null);
        this._genies.add(genie);
        genie.setProgress(reverse ? 1 : 0);

        const timeline = new Clutter.Timeline({actor: genie.actor, duration});
        this._timelines.add(timeline);
        timeline.connect('new-frame', () => {
            const p = timeline.get_progress();
            genie.setProgress(reverse ? 1 - p : p);
        });
        timeline.connect('stopped', () => {
            this._timelines.delete(timeline);
            this._genies.delete(genie);
            genie.destroy();
            onDone();
        });
        timeline.start();
    }

    _minimize(actor) {
        const content = this._content(actor);
        if (!content)
            return false;
        this._snapshots.set(actor, {content, width: actor.width, height: actor.height});
        this._runGenie(actor, content, false, () => {});
        return true;
    }

    _close(actor) {
        const content = this._content(actor);
        if (!content)
            return false;
        this._runGenie(actor, content, false, () => {}, CLOSE_MS);
        return true;
    }

    _afterRestore(actor) {
        if (!this._pendingRestore.delete(actor))
            return;
        // The picture taken at minimize time, if the window kept its size;
        // otherwise a fresh one.
        const saved = this._snapshots.get(actor);
        const sameSize = saved && saved.width === actor.width && saved.height === actor.height;
        const content = sameSize ? saved.content : this._content(actor);
        if (!content)
            return;
        // The real window stays invisible until the genie has landed.
        actor.opacity = 0;
        this._runGenie(actor, content, true, () => {
            actor.opacity = 255;
        });
    }
}
