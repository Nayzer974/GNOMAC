// macOS 27 lock screen on top of GNOME's UnlockDialog (authentication,
// PAM, notifications and user switching stay GNOME's):
//  - date and a very large clock at the top, never flying away,
//  - avatar, name and a glass password pill at the bottom,
//  - the wallpaper is crisp at rest and frosts while the prompt is up,
//  - prompt rises with a fade instead of GNOME's zoom crossfade.
//
// UnlockDialog is only built when the screen locks, so its prototype is
// patched once and every new dialog is decorated in _init.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ScreenShield} from 'resource:///org/gnome/shell/ui/screenShield.js';
import {UnlockDialog} from 'resource:///org/gnome/shell/ui/unlockDialog.js';
import {Avatar} from 'resource:///org/gnome/shell/ui/userWidget.js';

import {t} from '../lib/i18n.js';
import {hideDesktop, revealDesktop} from '../lib/reveal.js';

// ---------------------------------------------------------------------------
// The unlock transition: lock screen -> desktop, in two beats.
//
//   A. the lock UI leaves (the wallpaper stays as it is, frosted):
//        0 ms  password UI fades and contracts (200 ms)
//       30 ms  clock lifts and fades (200 ms)
//   -- the shell leaves the lock mode and rebuilds the desktop (dock, widgets,
//      glass): a one-off cost of a few hundred ms. It happens HERE, on a still
//      frame with nothing moving, and the animations of B only start after it:
//      started before, they were time-based and had already run by the time
//      the first frame came, so the lock screen seemed to cut to the desktop. --
//   B. the wallpaper dissolves into the desktop:
//        0 ms  the frost and dimming of the wallpaper ease out (400 ms)
//        0 ms  the lock layer dissolves (380 ms) and uncovers the desktop
//      100-... menu bar, dock, windows are revealed (lib/reveal.js)
// Ease-out curves, no bounce, no overshoot.
// ---------------------------------------------------------------------------
const LEAVE_MS = 200;
const FRAME_MS = 32; // let the rebuilt (and hidden) desktop be drawn once before B
const DISSOLVE_MS = 380;
const FROST_MS = 400;

function unlockTransition(shield, dialog, extension, done, slow = 1, rebuild = () => {}) {
    const ms = v => Math.round(v * slow);
    const group = shield._lockDialogGroup;
    const OUT = Clutter.AnimationMode.EASE_OUT_QUAD;

    // A. The lock UI leaves.
    if (dialog) {
        const fadeOut = actor => actor?.ease({opacity: 0, duration: ms(LEAVE_MS), mode: OUT});
        if (dialog._promptBox) {
            dialog._promptBox.set_pivot_point(0.5, 0.5);
            dialog._promptBox.ease({opacity: 0, scale_x: 0.97, scale_y: 0.97, duration: ms(LEAVE_MS), mode: OUT});
        }
        fadeOut(dialog._gnomacRest);
        fadeOut(dialog._otherUserButton);
        dialog._clock?.ease({opacity: 0, translation_y: -10, duration: ms(LEAVE_MS), delay: ms(30), mode: OUT});
    }

    const dissolve = () => {
        // B. The wallpaper dissolves into the desktop (already hidden, see below).
        if (dialog) {
            const widgets = [...(dialog._backgroundGroup ?? [])];
            const starts = widgets.map(w => {
                const effect = w.get_effect('blur');
                return effect ? {effect, radius: effect.radius, brightness: effect.brightness} : null;
            }).filter(Boolean);
            if (starts.length) {
                const timeline = new Clutter.Timeline({actor: group, duration: ms(FROST_MS)});
                timeline.connect('new-frame', () => {
                    const eased = 1 - (1 - timeline.get_progress()) ** 3;
                    for (const {effect, radius, brightness} of starts) {
                        effect.set({radius: Math.max(1, Math.round(radius * (1 - eased))),
                            brightness: brightness + (1 - brightness) * eased});
                    }
                });
                timeline.start();
            }
        }

        group.set_pivot_point(0.5, 0.5);
        group.ease({opacity: 0, duration: ms(DISSOLVE_MS), mode: OUT});

        revealDesktop(extension, {slow, onDone: () => {
            done();
            // The next lock starts from a clean layer.
            group.remove_all_transitions();
            group.opacity = 255;
            group.translation_y = 0;
            group.set_scale(1, 1);
        }});
    };

    const beats = [];
    const later = (delay, fn) => {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            beats.splice(beats.indexOf(id), 1);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        beats.push(id);
    };
    // Rebuild the desktop once the lock UI is gone, hide it, wait one frame, go.
    later(ms(LEAVE_MS + 30), () => {
        try {
            rebuild();
            hideDesktop(extension);
        } catch (e) {
            logError(e, 'GNOMAC unlock transition');
            done();
            return;
        }
        later(FRAME_MS, dissolve);
    });
    return () => {
        for (const id of beats.splice(0))
            GLib.source_remove(id);
    };
}

const TOP = 0.075; // clock distance from the top, fraction of the height
const BOTTOM = 0.07; // prompt distance from the bottom
const BLUR_RADIUS = 48;
const BLUR_DIM = 0.22;

// Clock at the top, notifications under it, prompt (and the resting user
// chip) at the bottom, user switch button in the corner.
const MacUnlockLayout = GObject.registerClass(
class MacUnlockLayout extends Clutter.LayoutManager {
    _init(dialog) {
        super._init();
        this._dialog = dialog;
    }

    vfunc_get_preferred_width(_container, forHeight) {
        return this._dialog._stack.get_preferred_width(forHeight);
    }

    vfunc_get_preferred_height(_container, forWidth) {
        return this._dialog._stack.get_preferred_height(forWidth);
    }

    _place(actor, x, y) {
        const [, , w, h] = actor.get_preferred_size();
        const box = new Clutter.ActorBox();
        box.x1 = Math.round(x - w / 2);
        box.y1 = Math.round(y);
        box.x2 = box.x1 + w;
        box.y2 = box.y1 + h;
        actor.allocate(box);
        return h;
    }

    vfunc_allocate(_container, box) {
        const d = this._dialog;
        const [width, height] = box.get_size();
        const centre = width / 2;

        const clockHeight = this._place(d._clock, centre, height * TOP);

        const [, , , stackHeight] = d._stack.get_preferred_size();
        const promptY = height * (1 - BOTTOM) - stackHeight;
        this._place(d._stack, centre, promptY);

        const [, , , restHeight] = d._gnomacRest.get_preferred_size();
        this._place(d._gnomacRest, centre, height * (1 - BOTTOM) - restHeight);

        const notificationsY = height * TOP + clockHeight + 24;
        const [, , nw, nh] = d._notificationsBox.get_preferred_size();
        const notificationsBox = new Clutter.ActorBox();
        notificationsBox.x1 = Math.round(centre - nw / 2);
        notificationsBox.y1 = Math.round(notificationsY);
        notificationsBox.x2 = notificationsBox.x1 + nw;
        notificationsBox.y2 = notificationsBox.y1 +
            Math.max(0, Math.min(nh, promptY - notificationsY - 24));
        d._notificationsBox.allocate(notificationsBox);

        const button = d._otherUserButton;
        if (button.visible) {
            const [, , bw, bh] = button.get_preferred_size();
            const buttonBox = new Clutter.ActorBox();
            buttonBox.x1 = Math.round(width - bw * 2);
            buttonBox.y1 = Math.round(height - bh * 2);
            buttonBox.x2 = buttonBox.x1 + bw;
            buttonBox.y2 = buttonBox.y1 + bh;
            button.allocate(buttonBox);
        }
    }
});

function decorate(dialog) {
    dialog.add_style_class_name('gnomac-lock');
    dialog._gnomacProgress = 0;

    // macOS shows the date above the time.
    const clock = dialog._clock;
    clock.set_child_below_sibling(clock._date, clock._time);
    clock._hint.hide();

    // Pull the clock out of the shared stack so it can live at the top.
    dialog._stack.remove_child(clock);
    const mainBox = dialog._stack.get_parent();
    mainBox.add_child(clock);

    // Resting user chip, shown until the real prompt takes over.
    const rest = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gnomac-lock-rest',
        reactive: true,
    });
    const avatar = new Avatar(dialog._user, {styleClass: 'gnomac-lock-avatar'});
    avatar.x_align = Clutter.ActorAlign.CENTER;
    avatar.update();
    rest.add_child(avatar);
    rest.add_child(new St.Label({
        text: dialog._user.get_real_name() || dialog._userName,
        style_class: 'gnomac-lock-name',
        x_align: Clutter.ActorAlign.CENTER,
    }));
    rest.add_child(new St.Label({
        text: t('Enter Password', 'Saisir le mot de passe'),
        style_class: 'gnomac-lock-pill',
        x_align: Clutter.ActorAlign.CENTER,
    }));
    rest.connect('button-release-event', () => {
        dialog._showPrompt();
        return Clutter.EVENT_STOP;
    });
    mainBox.add_child(rest);
    dialog._gnomacRest = rest;

    mainBox.layout_manager = new MacUnlockLayout(dialog);
    dialog._setTransitionProgress(dialog._adjustment.value);
}

export class LockScreen {
    constructor(extension) {
        this._extension = extension;
    }

    enable() {
        const proto = UnlockDialog.prototype;
        // GNOME slides the lock screen away: replaced by the unlock transition.
        const shieldProto = ScreenShield.prototype;
        this._savedShield = {_continueDeactivate: shieldProto._continueDeactivate};
        const savedShield = this._savedShield;
        const extension = this._extension;
        const self = this;
        shieldProto._continueDeactivate = function (animate) {
            // A password unlock arrives through logind's Unlock signal, which
            // calls deactivate(false): `animate` is false for the real unlock, so
            // it must not decide. What matters is that the lock screen is up.
            const wanted = this.actor.visible && !this._isGreeter && St.Settings.get().enable_animations &&
                extension.getSettings().get_boolean('enable-unlock-animation');
            if (!wanted)
                return savedShield._continueDeactivate.call(this, animate);
            try {
                const dialog = this._dialog;
                // GNOME's own steps, minus the slide: state bookkeeping first.
                this._hideLockScreen(false);
                this._lockDialogGroup.remove_all_transitions();
                this._lockDialogGroup.translation_y = 0;
                this.emit('wake-up-screen');
                dialog?.popModal();
                if (this._grab) {
                    Main.popModal(this._grab);
                    this._grab = null;
                }
                this._longLightbox.lightOff();
                this._shortLightbox.lightOff();
                // Leaving the unlock-dialog mode rebuilds the desktop modules: the
                // transition does it once the lock UI has left (see above).
                const rebuild = () => {
                    // The rebuild disables and enables this module again: it is
                    // no longer "disabled in the middle of the transition".
                    self._cancelUnlock = null;
                    if (Main.sessionMode.currentMode === 'unlock-dialog')
                        Main.sessionMode.popMode('unlock-dialog');
                };
                let finished = false;
                const done = () => {
                    finished = true;
                    self._cancelUnlock = null;
                    this._completeDeactivate();
                };
                const cancel = unlockTransition(this, dialog, extension, done,
                    Number(globalThis.GNOMAC_UNLOCK_SPEED) || 1, rebuild);
                // Disabled in the middle of the transition: never leave the user locked in.
                self._cancelUnlock = () => {
                    self._cancelUnlock = null;
                    cancel();
                    if (finished)
                        return;
                    try {
                        rebuild();
                    } catch (e) {
                        logError(e, 'GNOMAC unlock transition');
                    }
                    done();
                };
            } catch (e) {
                logError(e, 'GNOMAC unlock transition');
                // Never leave the user locked in: finish the plain way.
                this._completeDeactivate();
            }
            return undefined;
        };
        self._unlockPatched = true;

        this._saved = {
            _init: proto._init,
            _setTransitionProgress: proto._setTransitionProgress,
            _updateBackgroundEffects: proto._updateBackgroundEffects,
        };
        const saved = this._saved;

        proto._init = function (...args) {
            saved._init.apply(this, args);
            try {
                decorate(this);
            } catch (e) {
                logError(e, 'GNOMAC lock screen');
            }
        };

        proto._setTransitionProgress = function (progress) {
            if (!this._gnomacRest)
                return saved._setTransitionProgress.call(this, progress);
            this._gnomacProgress = progress;

            // Clock stays put; the prompt replaces the resting chip with a
            // short rise, like macOS waking to the password field.
            this._clock.visible = true;
            this._clock.set({opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0});
            this._promptBox.visible = progress > 0;
            this._promptBox.set({
                opacity: 255 * progress,
                scale_x: 1,
                scale_y: 1,
                translation_y: 24 * (1 - progress),
            });
            this._gnomacRest.visible = progress < 1;
            this._gnomacRest.set({opacity: 255 * (1 - progress), translation_y: -12 * progress});
            this._otherUserButton.set({
                reactive: progress > 0,
                can_focus: progress > 0,
                opacity: 255 * progress,
            });
            this._updateBackgroundEffects();
            return undefined;
        };

        // Crisp wallpaper at rest, frosted glass behind the prompt.
        proto._updateBackgroundEffects = function () {
            if (!this._gnomacRest)
                return saved._updateBackgroundEffects.call(this);
            const progress = this._gnomacProgress ?? 0;
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
            for (const widget of this._backgroundGroup) {
                const effect = widget.get_effect('blur');
                effect?.set({
                    enabled: progress > 0.01,
                    brightness: 1 - BLUR_DIM * progress,
                    radius: Math.max(1, BLUR_RADIUS * progress * scaleFactor),
                });
            }
            return undefined;
        };
    }

    disable() {
        this._cancelUnlock?.();
        if (this._savedShield) {
            ScreenShield.prototype._continueDeactivate = this._savedShield._continueDeactivate;
            this._savedShield = null;
        }
        if (!this._saved)
            return;
        Object.assign(UnlockDialog.prototype, this._saved);
        this._saved = null;
    }
}
