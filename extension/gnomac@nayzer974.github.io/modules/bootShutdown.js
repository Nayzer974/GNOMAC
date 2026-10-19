// Start-up and shut-down animations, after macOS 26/27.
//
// Start-up, "mist" style (the default): the screen is black while GNOME
// starts, then the desktop appears through a very light haze, as if a thin
// fog lifted: the wallpaper starts blurred and pale and comes into focus
// while the veil fades, the menu bar fades in and the dock drifts up. About a
// second, no logo.
//
// Start-up ("hello" style), in three acts:
//   1. black screen, the logo is traced by a thin line, fills with glass and a
//      sheen sweeps across it; a hair-thin progress bar fills underneath,
//   2. the logo melts away into the wallpaper, heavily blurred, which comes
//      into focus,
//   3. greetings are written in glass script, one stroke at a time, in the
//      user's language first ("bonjour", "hello", "hola"…),
//   then the overlay dissolves, the menu bar fades in and the dock rises.
// Styles: "mist", "hello" (all of it), "logo" (act 1 only), "classic" (the former
// logo and bar). Clicking the overlay skips to the desktop.
//
// Shut down / restart / log out: GNOME's confirmation dialog is wrapped: once
// the user confirms, the screen dims to black, the logo appears with
// "Shutting down…" and a bar, and only then is the real
// ConfirmedShutdown/Reboot/Logout signal sent to gnome-session.
//
// The shutdown overlay is only shown for real: tests set
// `globalThis.GNOMAC_DRY_RUN` and the original `_confirm` is then replaced
// by a no-op after the animation, so nothing is ever powered off.
// `globalThis.GNOMAC_BOOT_SPEED` (2 = twice as slow) lets a test catch frames.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EndSessionDialog} from 'resource:///org/gnome/shell/ui/endSessionDialog.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {easeInOut, easeOut, greetingOrder, paintLogo, paintWord} from '../lib/bootArt.js';
import {LensSurface} from '../lib/lensEffect.js';
import {hideDesktop, removeRevealBlur, revealDesktop, settleDesktop, unblurWallpaper} from '../lib/reveal.js';
import {t} from '../lib/i18n.js';

// How long the cover takes to dissolve.
const fadeMs = quick => (quick ? 500 : 750);

// How long the lens takes to cover the screen.
const LENS_MS = 900;

const MESSAGES = {
    ConfirmedShutdown: ['Shutting down…', 'Arrêt en cours…'],
    ConfirmedReboot: ['Restarting…', 'Redémarrage…'],
    ConfirmedLogout: ['Logging out…', 'Fermeture de la session…'],
};

// One full-screen overlay: logo, optional wallpaper plate, greetings, caption
// and a progress bar. Every drawn part is a Cairo area repainted from a few
// numbers (this.logo, this.word) that the sequence animates.
class Overlay {
    constructor(extension, {caption = '', withPlate = false, withLens = false} = {}) {
        this._settings = extension.getSettings();
        const monitor = Main.layoutManager.primaryMonitor;
        this._monitor = monitor;
        this.actor = new St.Widget({
            style_class: 'gnomac-boot',
            reactive: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            opacity: 0,
        });

        // The wallpaper, blurred, for the greetings (below the black cover).
        this.plate = null;
        if (withPlate) {
            this.plate = new GlassSurface({
                backdrop: 'wallpaper',
                blur: 70,
                glass: {...glassParamsFromSettings(this._settings, 0), tint: [0.02, 0.03, 0.06, 0.28],
                    refraction: 0, chroma: 0, rim: 0, sheen: 0, depthShade: 0},
            });
            this.plate.set_size(monitor.width, monitor.height);
            this.plate.opacity = 0;
            this.actor.add_child(this.plate);
        }

        // The lens (start-up style "lens"): built now, while GNOME is still
        // starting, so its wallpaper is loaded by the time it opens.
        this.lens = null;
        if (withLens) {
            this.lens = new LensSurface(monitor, [monitor.width / 2, monitor.height * 0.47]);
            // Almost transparent, not hidden: a hidden actor is not painted, and
            // the first paint (texture, shader) would then hit the opening.
            this.lens.opacity = 1;
            this.actor.add_child(this.lens);
        }

        this.base = new St.Widget({style_class: 'gnomac-boot-base', x: 0, y: 0,
            width: monitor.width, height: monitor.height});
        this.actor.add_child(this.base);

        // The logo, drawn.
        this.logo = {stroke: 0, fill: 0, sheen: -1};
        const size = Math.round(Math.max(120, monitor.height * 0.25));
        this.logoSize = size;
        this.logoArea = new St.DrawingArea({width: size, height: size, reactive: false,
            x: Math.round((monitor.width - size) / 2), y: Math.round(monitor.height * 0.40 - size / 2)});
        this.logoArea.set_pivot_point(0.5, 0.5);
        this.logoArea.connect('repaint', area => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            try {
                paintLogo(cr, w, h, this.logo);
            } finally {
                cr.$dispose();
            }
        });
        this.actor.add_child(this.logoArea);

        // The greetings, written.
        this.word = {key: null, write: 0, fill: 0, alpha: 1};
        const wordWidth = Math.round(monitor.width * 0.7);
        const wordHeight = Math.round(monitor.height * 0.55);
        this.wordArea = new St.DrawingArea({width: wordWidth, height: wordHeight, reactive: false,
            x: Math.round((monitor.width - wordWidth) / 2), y: Math.round(monitor.height * 0.18)});
        this.wordArea.connect('repaint', area => {
            if (!this.word.key)
                return;
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            try {
                paintWord(cr, w, h, this.word.key, this.word);
            } finally {
                cr.$dispose();
            }
        });
        this.actor.add_child(this.wordArea);

        this.caption = new St.Label({text: caption, style_class: 'gnomac-boot-caption', opacity: 0});
        this.actor.add_child(this.caption);

        const barWidth = Math.round(Math.max(150, monitor.width * 0.13));
        this.track = new St.Widget({style_class: 'gnomac-boot-track', width: barWidth, height: 4,
            x: Math.round((monitor.width - barWidth) / 2), y: Math.round(monitor.height * 0.40 + size * 0.62),
            opacity: 0});
        this.fill = new St.Widget({style_class: 'gnomac-boot-fill', width: 0, height: 4});
        this.track.add_child(this.fill);
        this.actor.add_child(this.track);
        this.barWidth = barWidth;

        Main.layoutManager.uiGroup.add_child(this.actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this.plate?.setStageOrigin(monitor.x, monitor.y);
        // Text is measured only once the actor is on stage.
        this._centerCaption();
    }

    _centerCaption() {
        if (!this.actor.get_stage())
            return;
        const [, w] = this.caption.get_preferred_width(-1);
        this.caption.set_position(Math.round((this._monitor.width - w) / 2),
            Math.round(this._monitor.height * 0.40 + this.logoSize * 0.62 + 28));
    }

    repaintLogo() {
        this.logoArea.queue_repaint();
    }

    repaintWord() {
        this.wordArea.queue_repaint();
    }

    destroy() {
        this.actor.destroy();
    }
}

export class BootShutdown {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._timelines = new Set();
    }

    enable() {
        // The boot animation belongs to a real session start, never to a
        // later reload of the extension.
        if (Main.layoutManager._startingUp && !Main.sessionMode.isLocked) {
            const plymouth = this._plymouthActive();
            const style = this._settings.get_string('boot-style');
            const mode = this._settings.get_string('boot-animation');
            // With the Plymouth theme the logo has already played before the
            // login screen: only the greetings, which are new, are shown.
            if (mode !== 'never') {
                if (style === 'lens')
                    this._playBoot({lens: true});
                else if (style === 'mist')
                    this._playBoot({mist: true});
                else if (style === 'hello')
                    this._playBoot({logo: !plymouth || mode === 'always', hello: true});
                else if (!plymouth || mode === 'always')
                    this._playBoot({logo: true, hello: false, classic: style === 'classic'});
            }
        }
        this._wrapEndSession();
    }

    disable() {
        this._unwrapEndSession();
        this._stopAll();
        this._restoreChrome();
        this._boot?.destroy();
        this._boot = null;
        this._shutdown?.destroy();
        this._shutdown = null;
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
    }

    // Spotlight > "Preview Start-up Animation": the configured style, now.
    previewBoot() {
        const style = this._settings.get_string('boot-style');
        if (style === 'lens')
            this._playBoot({lens: true, immediate: true});
        else if (style === 'mist')
            this._playBoot({mist: true, immediate: true});
        else if (style === 'hello')
            this._playBoot({logo: true, hello: true, immediate: true});
        else
            this._playBoot({logo: true, hello: false, classic: style === 'classic', immediate: true});
    }

    // ------------------------------------------------------------ helpers

    get _slow() {
        return Number(globalThis.GNOMAC_BOOT_SPEED) || 1;
    }

    _plymouthActive() {
        const mode = this._settings.get_string('boot-animation');
        if (mode === 'always')
            return false;
        if (mode === 'never')
            return true;
        // 'auto': the logo is skipped only if our Plymouth theme is in use.
        try {
            const [ok, bytes] = GLib.file_get_contents('/etc/plymouth/plymouthd.conf');
            if (ok && /^\s*Theme\s*=\s*gnomac\s*$/m.test(new TextDecoder().decode(bytes)))
                return true;
        } catch {}
        return false;
    }

    // Runs update(0..1) over `ms`, then done().
    _tween(owner, ms, update, done) {
        const timeline = new Clutter.Timeline({actor: owner, duration: Math.max(1, Math.round(ms * this._slow))});
        this._timelines.add(timeline);
        timeline.connect('new-frame', () => update(timeline.get_progress()));
        timeline.connect('completed', () => {
            this._timelines.delete(timeline);
            update(1);
            done?.();
        });
        timeline.connect('stopped', () => this._timelines.delete(timeline));
        timeline.start();
        return timeline;
    }

    _after(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(ms * this._slow), () => {
            this._timers?.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        (this._timers ??= new Set()).add(id);
    }

    _stopAll() {
        for (const timeline of [...this._timelines])
            timeline.stop();
        this._timelines.clear();
        for (const id of this._timers ?? [])
            GLib.source_remove(id);
        this._timers = null;
    }

    // ------------------------------------------------------------ boot

    // opts: {logo, hello, classic}. Waits for GNOME to finish starting unless
    // a test passes `immediate`.
    _playBoot(opts = {}) {
        const {logo = true, hello = true, classic = false, immediate = false, mist = false, lens = false} = opts;
        this._stopAll();
        this._boot?.destroy();
        const overlay = new Overlay(this._extension, {withPlate: hello || mist, withLens: lens});
        this._boot = overlay;
        this._skipped = false;
        // The cover is up before GNOME draws anything.
        overlay.actor.opacity = 255;
        overlay.actor.connect('button-press-event', () => {
            this._skipBoot(overlay);
            return Clutter.EVENT_STOP;
        });

        // Chrome stays hidden under the cover so it can come in at the end.
        this._hideChrome();

        const duration = this._settings.get_int('boot-duration');
        let started = !Main.layoutManager._startingUp || immediate;
        let proceed = null;
        const whenReady = callback => {
            if (started)
                callback();
            else
                proceed = callback;
        };
        if (!started) {
            const id = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(id);
                this._startupId = 0;
                started = true;
                proceed?.();
            });
            this._startupId = id;
        }

        const next = () => {
            if (this._boot !== overlay || this._skipped)
                return;
            if (lens) {
                this._lens(overlay);
            } else if (mist) {
                this._mist(overlay);
            } else {
                // The dock, widgets and desktop icons were built after the cover
                // went up: hide them too, under the cover, so that the reveal
                // brings them in.
                if (this._chromeHidden)
                    this._hideChrome();
                if (hello)
                    this._hello(overlay);
                else
                    this._reveal(overlay, classic);
            }
        };

        if (mist || lens) {
            // Black until GNOME is ready, then the haze lifts (or the lens opens).
            whenReady(next);
            return;
        }

        if (!logo) {
            whenReady(next);
            return;
        }

        if (classic) {
            // The former look: the finished logo fades in with a bar.
            overlay.logo.stroke = 0;
            overlay.logo.fill = 1;
            overlay.repaintLogo();
            overlay.logoArea.opacity = 0;
            overlay.logoArea.set_scale(0.9, 0.9);
            overlay.logoArea.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 700 * this._slow, delay: 150,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        } else {
            // Act 1: the line, then the glass, then the sheen.
            this._tween(overlay.actor, 1150, p => {
                overlay.logo.stroke = easeInOut(p);
                overlay.repaintLogo();
            }, () => {
                this._tween(overlay.actor, 700, p => {
                    overlay.logo.fill = easeOut(p);
                    overlay.logo.stroke = 1;
                    overlay.repaintLogo();
                });
                this._after(350, () => {
                    this._tween(overlay.actor, 1100, p => {
                        overlay.logo.sheen = p;
                        overlay.repaintLogo();
                    }, () => {
                        overlay.logo.sheen = -1;
                        overlay.repaintLogo();
                    });
                });
            });
        }

        // The hair-thin bar appears under the logo and fills while GNOME starts.
        this._after(classic ? 450 : 1250, () => {
            if (this._boot !== overlay)
                return;
            overlay.track.ease({opacity: 255, duration: 400 * this._slow});
            overlay.fill.set_width(0);
            this._tween(overlay.actor, duration, p => {
                overlay.fill.set_width(Math.round(overlay.barWidth * (1 - (1 - p) ** 2)));
            }, () => whenReady(next));
        });
    }

    _skipBoot(overlay) {
        if (this._boot !== overlay || this._skipped)
            return;
        this._skipped = true;
        this._stopAll();
        this._reveal(overlay, false);
    }

    // The lens: from a black screen, a disc of liquid glass opens at the centre
    // and grows until it is the whole screen. Through it the wallpaper is seen
    // bent at the rim like through a real lens; once it covers the screen the
    // lens melts away and the desktop is revealed by the same reveal as an
    // unlock (lib/reveal.js): blur to sharp, then the elements settle in.
    _lens(overlay) {
        const slow = this._slow;
        const lens = overlay.lens;
        // The dock, widgets and desktop icons were built after the cover went up
        // (this module loads first): hide them now, under the cover, so that
        // the reveal can bring them in.
        if (this._chromeHidden)
            hideDesktop(this._extension);
        const monitor = Main.layoutManager.primaryMonitor;
        const centreX = monitor.width / 2;
        const centreY = monitor.height * 0.47;
        const start = monitor.height * 0.03;
        // Far enough to cover the farthest corner.
        const end = Math.hypot(Math.max(centreX, monitor.width - centreX),
            Math.max(centreY, monitor.height - centreY)) + 8;
        // The lens is ABOVE the black cover (the cover stays around it). It
        // keeps the size of the screen; only its radius changes (lib/lensEffect.js).
        overlay.actor.set_child_above_sibling(lens, overlay.base);
        lens.setRadius(start);
        lens.opacity = 255;
        let revealed = false;
        this._tween(overlay.actor, LENS_MS, p => {
            lens.setRadius(start + (end - start) * easeOut(p));
            // The desktop starts to be revealed while the lens is still opening.
            if (!revealed && p > 0.45 && this._chromeHidden) {
                revealed = true;
                revealDesktop(this._extension, {slow, onDone: () => this._restoreChrome()});
            }
        }, () => {
            // The lens covers the screen: it melts into the desktop.
            this._tween(overlay.actor, 320, p => {
                lens.opacity = Math.round(255 * (1 - easeOut(p)));
                overlay.base.opacity = 0;
            }, () => {
                this._after(120, () => {
                    if (this._boot === overlay) {
                        overlay.destroy();
                        this._boot = null;
                    }
                });
            });
        });
    }

    // The desktop through a thin haze: the black cover gives way to a pale,
    // blurred wallpaper, which comes into focus while its veil fades; the
    // menu bar and the dock arrive softly with it.
    _mist(overlay) {
        const slow = this._slow;
        // The dock, widgets and desktop icons were built after the cover went
        // up (this module loads first): hide them now so that the reveal can
        // bring them in.
        if (this._chromeHidden)
            hideDesktop(this._extension);
        const plate = overlay.plate;
        // The veil: the wallpaper, frosted and slightly pale, over the black.
        plate?.setGlass({tint: [0.92, 0.95, 1.0, 0.24]});
        plate?.setBlur(48);
        plate?.ease({opacity: 255, duration: Math.round(280 * slow), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        overlay.base.ease({opacity: 0, duration: Math.round(280 * slow), mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        // A thin haze that thins and drifts up as the veil lifts.
        const monitor = Main.layoutManager.primaryMonitor;
        const haze = new St.Widget({reactive: false, x: 0, y: 0, width: monitor.width,
            height: Math.round(monitor.height * 0.7), opacity: 0, style_class: 'gnomac-boot-haze'});
        overlay.actor.add_child(haze);
        haze.ease({opacity: 255, duration: Math.round(280 * slow), mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        // The same reveal as an unlock: the veil's blur and opacity ease out
        // together while the desktop is revealed underneath.
        this._after(200, () => {
            if (this._boot !== overlay || this._skipped)
                return;
            haze.ease({translation_y: -48, opacity: 0, duration: Math.round(520 * slow),
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            if (this._chromeHidden)
                revealDesktop(this._extension, {slow, onDone: () => this._restoreChrome()});
            this._tween(overlay.actor, 520, p => {
                if (!plate)
                    return;
                const eased = easeOut(p);
                plate.setBlur(Math.max(1, Math.round(48 * (1 - eased))));
                plate.opacity = Math.round(255 * (1 - eased));
            }, () => {
                this._after(160, () => {
                    if (this._boot === overlay) {
                        overlay.destroy();
                        this._boot = null;
                    }
                });
            });
        });
    }

    // Acts 2 and 3: the logo melts into a blurred wallpaper that comes into
    // focus while greetings are written over it.
    _hello(overlay) {
        const keys = greetingOrder(this._settings.get_int('boot-hello-words'));
        overlay.logoArea.ease({opacity: 0, scale_x: 0.88, scale_y: 0.88, duration: 450 * this._slow,
            mode: Clutter.AnimationMode.EASE_IN_QUAD});
        overlay.track.ease({opacity: 0, duration: 300 * this._slow});

        // The wallpaper fades in under the black, which fades away.
        overlay.plate?.ease({opacity: 255, duration: 800 * this._slow, delay: 200 * this._slow});
        overlay.base.ease({opacity: 0, duration: 800 * this._slow, delay: 200 * this._slow,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});

        // Out of focus to sharp over the whole greeting.
        const total = 600 + keys.length * 1500;
        this._tween(overlay.actor, total, p => overlay.plate?.setBlur(Math.round(70 - 64 * easeOut(p))));

        let index = 0;
        const write = () => {
            if (this._boot !== overlay || this._skipped)
                return;
            if (index >= keys.length) {
                this._after(500, () => this._reveal(overlay, false));
                return;
            }
            overlay.word.key = keys[index++];
            overlay.word.write = 0;
            overlay.word.fill = 0;
            overlay.word.alpha = 1;
            this._tween(overlay.actor, 850, p => {
                overlay.word.write = easeInOut(p);
                overlay.repaintWord();
            }, () => {
                // The glass fills in the strokes, then the word clears.
                this._tween(overlay.actor, 380, p => {
                    overlay.word.fill = easeOut(p);
                    overlay.repaintWord();
                }, () => this._after(380, () => {
                    this._tween(overlay.actor, 260, p => {
                        overlay.word.alpha = 1 - p;
                        overlay.repaintWord();
                    }, write);
                }));
            });
        };
        this._after(900, write);
    }

    // The cover dissolves; the menu bar fades in and the dock rises.
    _reveal(overlay, quick) {
        if (this._boot !== overlay)
            return;
        const slow = this._slow;
        const panel = Main.panel;
        const dock = this._dockActor();
        if (this._chromeHidden) {
            // The wallpaper under the cover comes out of its blur as the cover
            // goes (it used to snap sharp at the very end), the windows follow.
            unblurWallpaper(Math.round(fadeMs(quick) * slow), Math.round(160 * slow));
            global.window_group.ease({opacity: 255, duration: Math.round(500 * slow), delay: Math.round(160 * slow)});
            panel.ease({opacity: 255, duration: 650 * slow, delay: 250 * slow});
            if (dock) {
                dock.ease({translation_y: 0, opacity: 255, duration: 850 * slow, delay: 300 * slow,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK});
                this._dockItems().forEach((item, i) => {
                    item.set_pivot_point(0.5, 1);
                    item.ease({opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0, duration: 500 * slow,
                        delay: (550 + i * 45) * slow, mode: Clutter.AnimationMode.EASE_OUT_BACK});
                });
            }
        }
        const fade = fadeMs(quick);
        overlay.logoArea.ease({opacity: 0, scale_x: 1.35, scale_y: 1.35, duration: 520 * slow,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC});
        overlay.actor.ease({opacity: 0, duration: fade * slow, delay: 160 * slow,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onStopped: () => {
                if (this._boot === overlay) {
                    this._stopAll();
                    overlay.destroy();
                    this._boot = null;
                    this._restoreChrome();
                }
            }});
    }

    _dockActor() {
        return this._extension._modules?.find(m => m.constructor.name === 'Dock')?.actor ?? null;
    }

    _dockItems() {
        const dock = this._extension._modules?.find(m => m.constructor.name === 'Dock');
        return (dock?._items ?? []).filter(item => item && !item.is_finalized?.());
    }

    _hideChrome() {
        hideDesktop(this._extension);
        const dock = this._dockActor();
        Main.panel.opacity = 0;
        if (dock) {
            dock.opacity = 0;
            // Below the bottom edge: the dock "rises" into view.
            dock.translation_y = 24;
        }
        this._chromeHidden = true;
    }

    _restoreChrome() {
        removeRevealBlur();
        if (!this._chromeHidden)
            return;
        this._chromeHidden = false;
        // Menu bar, windows, dock and its icons, widgets and desktop icons: all
        // at their final state (some may never have been brought in, e.g. when
        // the animation is skipped).
        settleDesktop(this._extension);
        global.window_group.set_scale(1, 1);
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

    // Everything dims, the logo (already drawn) breathes once, a bar fills.
    _playShutdown(signal) {
        return new Promise(resolve => {
            const [en, fr] = MESSAGES[signal];
            const overlay = new Overlay(this._extension, {caption: t(en, fr)});
            this._shutdown = overlay;
            const ms = this._settings.get_int('shutdown-duration');
            overlay.logo.stroke = 1;
            overlay.logo.fill = 1;
            overlay.repaintLogo();
            overlay.actor.ease({opacity: 255, duration: 520, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            overlay.caption.ease({opacity: 255, duration: 450, delay: 350});
            overlay.track.ease({opacity: 255, duration: 350, delay: 350});
            // A last breath: the logo shrinks slightly and a sheen passes.
            overlay.logoArea.ease({scale_x: 0.94, scale_y: 0.94, duration: ms, delay: 300,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
            this._tween(overlay.actor, ms, p => {
                overlay.fill.set_width(Math.round(overlay.barWidth * (1 - (1 - p) ** 2)));
                overlay.logo.sheen = p * 1.1 - 0.05;
                overlay.repaintLogo();
            }, () => resolve());
        });
    }
}
