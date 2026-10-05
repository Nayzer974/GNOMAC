// Start-up and shut-down animations, as in macOS.
//
//  - start: a black screen with the logo that fades in, a thin progress bar
//    that fills, then the whole thing zooms and dissolves into the desktop,
//  - shut down / restart / log out: GNOME's confirmation dialog is wrapped:
//    once the user confirms, the screen dims to black, the logo appears with
//    "Shutting down…" and a bar, and only then is the real
//    ConfirmedShutdown/Reboot/Logout signal sent to gnome-session.
//
// The shutdown overlay is only shown for real: tests set
// `globalThis.GNOMAC_DRY_RUN` and the original `_confirm` is then replaced
// by a no-op after the animation, so nothing is ever powered off.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EndSessionDialog} from 'resource:///org/gnome/shell/ui/endSessionDialog.js';

import {t} from '../lib/i18n.js';

const MESSAGES = {
    ConfirmedShutdown: ['Shutting down…', 'Arrêt en cours…'],
    ConfirmedReboot: ['Restarting…', 'Redémarrage…'],
    ConfirmedLogout: ['Logging out…', 'Fermeture de la session…'],
};

function logoIcon(extension, size) {
    const settings = extension.getSettings();
    const file = settings.get_string('logo-style') === 'bridge' ? 'gnomac-logo' : 'apple';
    return new St.Icon({
        gicon: Gio.icon_new_for_string(`${extension.path}/icons/${file}.svg`),
        icon_size: size,
        style_class: 'gnomac-boot-logo',
    });
}

// One full-screen overlay: logo, optional caption, progress bar.
class Overlay {
    constructor(extension, {caption = '', black = true} = {}) {
        const monitor = Main.layoutManager.primaryMonitor;
        this.actor = new St.Widget({
            style_class: 'gnomac-boot',
            reactive: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            opacity: 0,
        });
        this.actor.set_style(`background-color: ${black ? '#000000' : 'rgba(0,0,0,0.0)'};`);
        const size = Math.round(Math.max(56, monitor.height * 0.11));
        this.logo = logoIcon(extension, size);
        this.logo.set_pivot_point(0.5, 0.5);
        this.logo.set_position(Math.round((monitor.width - size) / 2), Math.round(monitor.height * 0.42 - size / 2));
        this.actor.add_child(this.logo);

        this.caption = new St.Label({text: caption, style_class: 'gnomac-boot-caption', opacity: 0});
        this.actor.add_child(this.caption);

        const barWidth = Math.round(Math.max(150, monitor.width * 0.13));
        this.track = new St.Widget({style_class: 'gnomac-boot-track', width: barWidth, height: 4,
            x: Math.round((monitor.width - barWidth) / 2), y: Math.round(monitor.height * 0.42 + size * 0.9),
            opacity: 0});
        this.fill = new St.Widget({style_class: 'gnomac-boot-fill', width: 0, height: 4});
        this.track.add_child(this.fill);
        this.actor.add_child(this.track);
        this.barWidth = barWidth;

        Main.layoutManager.uiGroup.add_child(this.actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        // Text is measured only once the actor is on stage.
        this._centerCaption(monitor);
    }

    _centerCaption(monitor) {
        if (!this.actor.get_stage())
            return;
        const [, w] = this.caption.get_preferred_width(-1);
        this.caption.set_position(Math.round((monitor.width - w) / 2),
            Math.round(monitor.height * 0.42 + monitor.height * 0.11 * 0.9 + 24));
    }

    // Fill the bar over `ms`, with the ease of a real loading bar.
    progress(ms, onDone) {
        this.fill.set_width(0);
        const timeline = new Clutter.Timeline({actor: this.actor, duration: ms});
        timeline.connect('new-frame', () => {
            const p = timeline.get_progress();
            this.fill.set_width(Math.round(this.barWidth * (1 - (1 - p) ** 2)));
        });
        timeline.connect('completed', () => onDone?.());
        timeline.start();
        this._timeline = timeline;
    }

    destroy() {
        this._timeline?.stop();
        this.actor.destroy();
    }
}

export class BootShutdown {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
    }

    enable() {
        // The boot animation belongs to a real session start, never to a
        // later reload of the extension.
        if (Main.layoutManager._startingUp && !Main.sessionMode.isLocked)
            this._playBoot();
        this._wrapEndSession();
    }

    disable() {
        this._unwrapEndSession();
        this._boot?.destroy();
        this._boot = null;
        this._shutdown?.destroy();
        this._shutdown = null;
    }

    // ------------------------------------------------------------ boot

    _playBoot() {
        const duration = this._settings.get_int('boot-duration');
        this._boot = new Overlay(this._extension);
        const overlay = this._boot;
        // The cover is up before GNOME draws anything.
        overlay.actor.opacity = 255;
        overlay.logo.opacity = 0;
        overlay.logo.set_scale(0.9, 0.9);
        overlay.track.opacity = 0;

        overlay.logo.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 700, delay: 150,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        overlay.track.ease({opacity: 255, duration: 400, delay: 450});

        const finish = () => {
            if (this._boot !== overlay)
                return;
            // Fill, then zoom and dissolve into the desktop.
            overlay.progress(duration, () => {
                overlay.logo.ease({opacity: 0, scale_x: 1.35, scale_y: 1.35, duration: 520,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC});
                overlay.track.ease({opacity: 0, duration: 280});
                overlay.actor.ease({opacity: 0, duration: 650, delay: 180,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onStopped: () => {
                        if (this._boot === overlay) {
                            overlay.destroy();
                            this._boot = null;
                        }
                    }});
            });
        };
        // Play the bar at least until GNOME is done starting, never less
        // than the configured time.
        if (Main.layoutManager._startingUp) {
            const id = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(id);
                finish();
            });
            this._startupId = id;
        } else {
            finish();
        }
    }

    // ------------------------------------------------------------ shutdown

    _wrapEndSession() {
        const proto = EndSessionDialog.prototype;
        this._savedConfirm = proto._confirm;
        const saved = this._savedConfirm;
        const self = this;
        proto._confirm = async function (signal) {
            if (!self._settings.get_boolean('enable-shutdown-animation') || !MESSAGES[signal])
                return saved.call(this, signal);
            // The dialog closes itself; the animation covers what follows.
            await self._playShutdown(signal);
            if (globalThis.GNOMAC_DRY_RUN) {
                globalThis.GNOMAC_DRY_RUN_SIGNAL = signal;
                self._shutdown?.destroy();
                self._shutdown = null;
                return undefined;
            }
            return saved.call(this, signal);
        };
    }

    _unwrapEndSession() {
        if (this._savedConfirm) {
            EndSessionDialog.prototype._confirm = this._savedConfirm;
            this._savedConfirm = null;
        }
    }

    _playShutdown(signal) {
        return new Promise(resolve => {
            const [en, fr] = MESSAGES[signal];
            const overlay = new Overlay(this._extension, {caption: t(en, fr)});
            this._shutdown = overlay;
            const ms = this._settings.get_int('shutdown-duration');
            overlay.logo.set_scale(1.0, 1.0);
            overlay.actor.ease({opacity: 255, duration: 520, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            overlay.caption.ease({opacity: 255, duration: 450, delay: 350});
            overlay.track.ease({opacity: 255, duration: 350, delay: 350});
            // A last breath: the logo shrinks slightly while the bar fills.
            overlay.logo.ease({scale_x: 0.94, scale_y: 0.94, duration: ms, delay: 300,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
            overlay.progress(ms, () => resolve());
        });
    }
}
