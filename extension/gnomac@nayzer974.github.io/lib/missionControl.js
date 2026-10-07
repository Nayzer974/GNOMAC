// MissionControl: the windows of the current workspace shrink and arrange
// themselves on a grid; a click on one brings it back to full size and
// focuses it. The REAL window actors are transformed (translation + scale):
// nothing is destroyed or recreated, no clones.
//
//   calculateWindowOverviewBounds(sizes, area, options)   pure layout
//   enterMissionControl() / exitMissionControl(window?)
//
// What Mutter allows, and what it does not:
//  - allowed: a window actor can be moved and scaled on screen freely,
//  - not allowed: Mutter does not move the window's input region with it, so
//    while the grid is up a transparent shield grabs the pointer and the
//    keyboard and finds the window under the pointer itself (topmost first).
//    That works for pointer and Esc; it is not GNOME's overview, so no
//    drag-and-drop between workspaces, no live thumbnails of other workspaces
//    and no search. Experimental: reachable from Spotlight ("Mission
//    Control"), bound to no key.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Easing, MotionTokens, reducedMotion} from './motionTokens.js';
import {timelines} from './animationTimeline.js';

// sizes: [{width, height}, ...]; area: {x, y, width, height}. Returns one
// {x, y, width, height, scale} per size, same order: the arrangement that
// keeps the windows as large as possible, never larger than they are (times
// maxScale), with their proportions.
export function calculateWindowOverviewBounds(sizes, area, {gap = 28, padding = 56, maxScale = 0.85} = {}) {
    const n = sizes.length;
    if (!n)
        return [];
    const inner = {x: area.x + padding, y: area.y + padding,
        width: Math.max(1, area.width - 2 * padding), height: Math.max(1, area.height - 2 * padding)};
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const cellW = (inner.width - gap * (cols - 1)) / cols;
        const cellH = (inner.height - gap * (rows - 1)) / rows;
        if (cellW <= 0 || cellH <= 0)
            continue;
        const scales = sizes.map(s => Math.min(maxScale, cellW / s.width, cellH / s.height));
        const score = Math.min(...scales);
        if (!best || score > best.score)
            best = {cols, rows, cellW, cellH, scales, score};
    }
    if (!best)
        return sizes.map(s => ({x: area.x, y: area.y, width: s.width, height: s.height, scale: 1}));
    const {cols, rows, cellW, cellH, scales} = best;
    // The last row is centred when it is not full.
    return sizes.map((s, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const indent = (cols - inRow) * (cellW + gap) / 2;
        const col = i - row * cols;
        const w = s.width * scales[i];
        const h = s.height * scales[i];
        return {
            x: inner.x + indent + col * (cellW + gap) + (cellW - w) / 2,
            y: inner.y + row * (cellH + gap) + (cellH - h) / 2,
            width: w, height: h, scale: scales[i],
        };
    });
}

class MissionControl {
    constructor() {
        this._active = false;
        this._entries = [];
        this._runs = new Set();
    }

    get active() {
        return this._active;
    }

    _windows() {
        const workspace = global.workspace_manager.get_active_workspace();
        return global.get_window_actors()
            .filter(a => a.meta_window && !a.meta_window.minimized &&
                a.meta_window.get_workspace() === workspace &&
                a.meta_window.get_window_type() === Meta.WindowType.NORMAL)
            .sort((a, b) => a.get_parent().get_children().indexOf(a) - b.get_parent().get_children().indexOf(b));
    }

    enterMissionControl() {
        if (this._active)
            return false;
        const actors = this._windows();
        if (!actors.length)
            return false;
        const monitor = Main.layoutManager.primaryMonitor;
        const area = {x: monitor.x, y: monitor.y + Main.panel.height, width: monitor.width,
            height: monitor.height - Main.panel.height - 90};
        const frames = actors.map(a => a.meta_window.get_frame_rect());
        const bounds = calculateWindowOverviewBounds(frames, area);
        this._entries = actors.map((actor, i) => ({actor, frame: frames[i], bounds: bounds[i]}));

        this._shield = new St.Widget({reactive: true, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        Main.layoutManager.uiGroup.add_child(this._shield);
        this._shield.connect('button-release-event', (_a, event) => {
            const [x, y] = event.get_coords();
            this.exitMissionControl(this._windowAt(x, y));
            return Clutter.EVENT_STOP;
        });
        this._shield.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.exitMissionControl(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._grab = Main.pushModal(this._shield, {actionMode: Shell.ActionMode.OVERVIEW});
        this._active = true;
        this._animate(false);
        return true;
    }

    // `window` (a Meta.Window) is raised and focused as the grid folds back.
    exitMissionControl(window = null) {
        if (!this._active)
            return;
        this._active = false;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (window) {
            Main.activateWindow(window);
            // The chosen window is on top: bring its actor to the front too.
            const entry = this._entries.find(e => e.actor.meta_window === window);
            if (entry)
                entry.actor.get_parent().set_child_above_sibling(entry.actor, null);
        }
        this._animate(true, () => this._cleanup());
    }

    _windowAt(x, y) {
        for (const {actor, bounds} of [...this._entries].reverse()) {
            if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height)
                return actor.meta_window;
        }
        return null;
    }

    _animate(reverse, onDone) {
        for (const run of this._runs)
            run.cancel();
        this._runs.clear();
        for (const {actor} of this._entries)
            actor.set_pivot_point(0, 0);
        const apply = e => {
            const k = reverse ? 1 - e : e;
            for (const {actor, frame, bounds} of this._entries) {
                actor.translation_x = (bounds.x - frame.x) * k;
                actor.translation_y = (bounds.y - frame.y) * k;
                const scale = 1 + (bounds.scale - 1) * k;
                actor.set_scale(scale, scale);
            }
        };
        const run = timelines.run({
            duration: reducedMotion() ? 0 : MotionTokens.long, easing: Easing.smooth, onFrame: apply,
            onDone: () => {
                this._runs.delete(run);
                onDone?.();
            },
        });
        this._runs.add(run);
    }

    _cleanup() {
        for (const {actor} of this._entries) {
            try {
                actor.translation_x = 0;
                actor.translation_y = 0;
                actor.set_scale(1, 1);
            } catch {}
        }
        this._entries = [];
        this._shield?.destroy();
        this._shield = null;
    }

    // The extension is being disabled: put everything back at once.
    destroy() {
        for (const run of this._runs)
            run.cancel();
        this._runs.clear();
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._active = false;
        this._cleanup();
    }
}

export const missionControl = new MissionControl();
export const enterMissionControl = () => missionControl.enterMissionControl();
export const exitMissionControl = window => missionControl.exitMissionControl(window);
