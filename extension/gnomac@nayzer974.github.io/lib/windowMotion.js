// WindowMotionManager: the one place that moves windows.
//
//   open       launchFrom(target, actor)        from the dock icon to the window
//   close      closeTo(actor, content, target)   window -> dock icon
//   minimize   minimizeTo(actor, content, target)
//   restore    restoreFrom(actor, content, target)   the exact inverse
//   maximize / unmaximize   resize: old bounds -> new bounds (GNOME's own
//                           saved rectangle is restored by Mutter, we never
//                           recompute it)
//   workspace  workspaceTransition(progress)     depth while the workspaces slide
//
// Everything runs on the extension's single metronome (lib/animationTimeline.js)
// and the shared motion tokens (lib/motionTokens.js). No bounce, no overshoot.
//
// A window travels along a light curve to its dock icon while it narrows and
// shortens (never "scale 0" in the middle of the screen: it lands at the
// icon's own size) and melts away only over the last part of the trip. The
// path is configurable: calculateMinimizePath(from, to, {curve, compression}).

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Easing, MotionTokens, reducedMotion} from './motionTokens.js';
import {timelines} from './animationTimeline.js';

const rectOf = (x, y, width, height) => ({x, y, width, height, cx: x + width / 2, cy: y + height / 2});

export class WindowMotionManager {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._ghosts = new Set();
        this._runs = new Set();
        this._resizes = new WeakMap();
    }

    // ------------------------------------------------------------ geometry

    // A window actor's rectangle on the stage.
    getWindowOrigin(actor) {
        // The window's own frame: a window that has just been mapped has no
        // position on the stage yet (get_transformed_position() is not valid).
        const frame = actor.meta_window.get_frame_rect();
        return rectOf(frame.x, frame.y, frame.width, frame.height);
    }

    // The dock icon of the window's app, or the icon geometry the dock
    // published for it, or the bottom centre of the window's monitor.
    getDockTarget(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const dock = this._extension._modules?.find(m => m.constructor.name === 'Dock');
        const target = app ? dock?.getAppTarget?.(app.get_id()) : null;
        if (target)
            return target;
        try {
            const [ok, rect] = window.get_icon_geometry();
            if (ok && rect.width > 0)
                return rectOf(rect.x, rect.y, rect.width, rect.height);
        } catch {}
        const monitor = Main.layoutManager.monitors[window.get_monitor?.()] ?? Main.layoutManager.primaryMonitor;
        return rectOf(monitor.x + monitor.width / 2 - 24, monitor.y + monitor.height - 56, 48, 48);
    }

    // The trajectory of a window going from `from` to `to` (rectangles with
    // x, y, width, height, cx, cy). Returns sample(e), e in 0..1:
    //   {cx, cy, sx, sy, opacity}   centre, scale of the window, opacity 0..255
    //
    //   curve        0 = straight line; 0.12 = a light bow (default)
    //   compression  extra narrowing in the middle of the trip (0.12)
    //   fade         where the material starts to fade, 0..1 of the trip (0.55)
    //
    // Position follows a quadratic curve, width and height shrink at slightly
    // different rates (the window is "folded" towards the icon), and the
    // opacity only drops over the last part: the material disappears with the
    // geometry, not before.
    calculateMinimizePath(from, to, {curve = 0.12, compression = 0.12, fade = 0.55} = {}) {
        const dx = to.cx - from.cx;
        const dy = to.cy - from.cy;
        const length = Math.hypot(dx, dy) || 1;
        // Bow outwards, away from the column of the icon.
        const side = Math.sign(from.cx - to.cx) || 1;
        const control = {
            x: from.cx + dx * 0.5 + side * curve * length * 0.5,
            y: from.cy + dy * 0.45,
        };
        const tx = Math.max(0.04, to.width / Math.max(1, from.width));
        const ty = Math.max(0.04, to.height / Math.max(1, from.height));
        return e => {
            const u = 1 - e;
            const fold = 1 - compression * Math.sin(Math.PI * e);
            const widthK = Easing.easeInOut(e);
            const heightK = Math.min(1, e ** 0.85);
            const melt = Math.min(1, Math.max(0, (e - fade) / (1 - fade)));
            return {
                cx: u * u * from.cx + 2 * u * e * control.x + e * e * to.cx,
                cy: u * u * from.cy + 2 * u * e * control.y + e * e * to.cy,
                sx: (1 + (tx - 1) * widthK) * fold,
                sy: 1 + (ty - 1) * heightK,
                opacity: Math.round(255 * (1 - Easing.smooth(melt))),
            };
        };
    }

    // ------------------------------------------------------------ travel

    // A ghost carries the picture of a window that is no longer (or not yet)
    // on screen. It is the same picture all the way: nothing is swapped.
    _ghost(content, rect) {
        const ghost = new Clutter.Actor({x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            content, reactive: false});
        ghost.set_pivot_point(0.5, 0.5);
        global.window_group.add_child(ghost);
        global.window_group.set_child_above_sibling(ghost, null);
        this._ghosts.add(ghost);
        return ghost;
    }

    _drop(ghost) {
        this._ghosts.delete(ghost);
        ghost.destroy();
    }

    _place(actor, from, sample) {
        actor.translation_x = sample.cx - from.cx;
        actor.translation_y = sample.cy - from.cy;
        actor.set_scale(sample.sx, sample.sy);
        actor.opacity = sample.opacity;
    }

    _travel({actor, content, from, to, reverse, duration, onDone, path}) {
        const sample = this.calculateMinimizePath(from, to, path);
        const ghost = this._ghost(content, from);
        const apply = e => this._place(ghost, from, sample(reverse ? 1 - e : e));
        apply(0);
        const run = timelines.run({
            duration, easing: reverse ? Easing.easeOut : Easing.smooth,
            onFrame: e => apply(e),
            onDone: () => {
                this._runs.delete(run);
                this._drop(ghost);
                onDone?.();
            },
        });
        this._runs.add(run);
        return run;
    }

    minimizeTo(actor, content, target, onDone) {
        return this._travel({actor, content, from: this.getWindowOrigin(actor), to: target ?? this.getDockTarget(actor.meta_window),
            reverse: false, duration: MotionTokens.long, onDone, path: this._path()});
    }

    closeTo(actor, content, target, onDone) {
        return this._travel({actor, content, from: this.getWindowOrigin(actor), to: target ?? this.getDockTarget(actor.meta_window),
            reverse: false, duration: MotionTokens.long, onDone, path: this._path()});
    }

    // The exact inverse of the minimize: out of the icon, along the same path.
    restoreFrom(actor, content, target, onDone) {
        return this._travel({actor, content, from: this.getWindowOrigin(actor), to: target ?? this.getDockTarget(actor.meta_window),
            reverse: true, duration: MotionTokens.long, onDone, path: this._path()});
    }

    // A new window grows out of its icon: the real window is transformed (it
    // has not painted yet, so there is no picture to carry) along the same
    // path, a little faster than a restore.
    launchFrom(target, actor, onDone) {
        const from = this.getWindowOrigin(actor);
        const sample = this.calculateMinimizePath(from, target, this._path());
        actor.set_pivot_point(0.5, 0.5);
        const apply = e => {
            const s = sample(1 - e);
            this._place(actor, from, {...s, opacity: Math.round(255 * Math.min(1, e * 3.5))});
        };
        apply(0);
        const run = timelines.run({
            duration: MotionTokens.medium + 60, easing: Easing.easeOut,
            onFrame: apply,
            onDone: () => {
                this._runs.delete(run);
                this._settle(actor);
                onDone?.();
            },
        });
        this._runs.add(run);
        this._extension._modules?.find(m => m.constructor.name === 'Dock')?.pulseApp?.(
            Shell.WindowTracker.get_default().get_window_app(actor.meta_window)?.get_id());
        return run;
    }

    _settle(actor) {
        try {
            actor.translation_x = 0;
            actor.translation_y = 0;
            actor.set_scale(1, 1);
            actor.opacity = 255;
            actor.set_pivot_point(0, 0);
        } catch {}
    }

    _path() {
        return {curve: this._settings.get_double('window-path-curve')};
    }

    // ------------------------------------------------------------ maximise

    // Called when a window is about to change size (maximise, unmaximise,
    // tile): we keep a picture of the old frame.
    beginResize(actor, oldRect) {
        if (reducedMotion() || !oldRect || oldRect.width < 1 || oldRect.height < 1)
            return;
        let content = null;
        try {
            content = actor.paint_to_content(oldRect);
        } catch {}
        if (content)
            this._resizes.set(actor, {content, old: rectOf(oldRect.x, oldRect.y, oldRect.width, oldRect.height)});
    }

    // ...and when the new size is there: the old picture grows (or shrinks) to
    // the new rectangle while the live window does the opposite and takes over.
    // Mutter keeps the previous rectangle for the unmaximise, so going back
    // lands exactly where the window was: nothing is recomputed here.
    finishResize(actor) {
        const info = this._resizes.get(actor);
        if (!info)
            return;
        this._resizes.delete(actor);
        const frame = actor.meta_window.get_frame_rect();
        const to = rectOf(frame.x, frame.y, frame.width, frame.height);
        const from = info.old;
        const ghost = this._ghost(info.content, from);
        ghost.set_pivot_point(0, 0);
        actor.set_pivot_point(0, 0);
        const apply = e => {
            // The old picture: from the old rectangle to the new one, fading out.
            ghost.set_position(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
            ghost.set_size(Math.max(1, from.width + (to.width - from.width) * e),
                Math.max(1, from.height + (to.height - from.height) * e));
            ghost.opacity = Math.round(255 * (1 - Easing.smooth(Math.min(1, e * 1.25))));
            // The live window: from the old rectangle's size to its own.
            const sx = from.width / to.width + (1 - from.width / to.width) * e;
            const sy = from.height / to.height + (1 - from.height / to.height) * e;
            actor.set_scale(sx, sy);
            actor.translation_x = (from.x - to.x) * (1 - e);
            actor.translation_y = (from.y - to.y) * (1 - e);
            actor.opacity = Math.round(255 * Easing.smooth(Math.min(1, e * 1.25)));
        };
        apply(0);
        const run = timelines.run({
            duration: MotionTokens.long, easing: Easing.smooth, onFrame: apply,
            onDone: () => {
                this._runs.delete(run);
                this._drop(ghost);
                this._settle(actor);
            },
        });
        this._runs.add(run);
    }

    // ------------------------------------------------------------ workspaces

    // Depth while the workspaces slide: the window groups move apart as GNOME
    // slides them (animated or driven by a trackpad swipe) and, on top of
    // that, the one leaving recedes (a little smaller, a little fainter) while
    // the one arriving comes forward. `progress` is the monitor group's own
    // workspace progress (0 = first workspace of the move, 1 = last); with
    // several workspaces in a swipe the integer parts are the workspaces
    // themselves. Not a cube, no rotation: a plain depth cue.
    workspaceTransition(progress, monitorGroup) {
        for (const group of monitorGroup._workspaceGroups ?? []) {
            const at = monitorGroup._getWorkspaceGroupProgress(group);
            const depth = Math.min(1, Math.abs(at - progress));
            group.set_pivot_point(0.5, 0.5);
            const k = 1 - 0.045 * Easing.smooth(depth);
            group.set_scale(k, k);
            group.opacity = Math.round(255 * (1 - 0.4 * Easing.smooth(depth)));
        }
    }

    // ------------------------------------------------------------ lifecycle

    enable() {
        // Workspace slide: GNOME's controller builds a MonitorGroup per monitor
        // for each switch; we give each the depth cue and our timing.
        const controller = Main.wm._workspaceAnimation;
        if (controller?._prepareWorkspaceSwitch) {
            this._controller = controller;
            this._originalPrepare = controller._prepareWorkspaceSwitch;
            const manager = this;
            controller._prepareWorkspaceSwitch = function (...args) {
                const result = manager._originalPrepare.apply(this, args);
                try {
                    manager._decorateSwitch(this._switchData);
                } catch (e) {
                    logError(e, 'GNOMAC workspace transition');
                }
                return result;
            };
        }
        this._sizeChangeId = global.window_manager.connect('size-change',
            (_wm, actor, _change, oldRect) => this.beginResize(actor, oldRect));
        this._sizeChangedId = global.window_manager.connect('size-changed', (_wm, actor) => this.finishResize(actor));
    }

    _decorateSwitch(data) {
        for (const monitorGroup of data?.monitors ?? []) {
            const original = monitorGroup.ease_property.bind(monitorGroup);
            monitorGroup.ease_property = (property, value, params = {}) =>
                original(property, value, {...params, duration: MotionTokens.medium + 40,
                    mode: Clutter.AnimationMode.EASE_OUT_QUART});
            monitorGroup.connect('notify::progress', () =>
                this.workspaceTransition(monitorGroup.progress, monitorGroup));
            this.workspaceTransition(monitorGroup.progress, monitorGroup);
        }
    }

    disable() {
        if (this._controller && this._originalPrepare) {
            this._controller._prepareWorkspaceSwitch = this._originalPrepare;
            this._originalPrepare = null;
            this._controller = null;
        }
        if (this._sizeChangeId) {
            global.window_manager.disconnect(this._sizeChangeId);
            global.window_manager.disconnect(this._sizeChangedId);
            this._sizeChangeId = this._sizeChangedId = 0;
        }
        for (const run of this._runs)
            run.cancel();
        this._runs.clear();
        for (const ghost of [...this._ghosts])
            this._drop(ghost);
    }
}
