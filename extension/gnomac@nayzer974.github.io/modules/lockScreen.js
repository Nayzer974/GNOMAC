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
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ScreenShield} from 'resource:///org/gnome/shell/ui/screenShield.js';
import {UnlockDialog} from 'resource:///org/gnome/shell/ui/unlockDialog.js';
import {Avatar} from 'resource:///org/gnome/shell/ui/userWidget.js';

import {t} from '../lib/i18n.js';
import {hideDesktop, revealDesktop} from '../lib/reveal.js';

// ---------------------------------------------------------------------------
// The unlock transition: lock screen -> desktop, in about 600 ms, one timeline.
// GNOME slides the whole lock screen up; here the lock UI contracts and fades,
// the wallpaper loses its frost and brightens, and the desktop is revealed
// underneath (menu bar, dock and windows materialise, see lib/reveal.js).
//
//    0 ms  password UI starts to fade and contract (220 ms)
//   40 ms  clock lifts and fades (240 ms)
//    0 ms  blur and dimming of the wallpaper ease out (520 ms)
//  140 ms  the lock layer dissolves (380 ms) and uncovers the desktop
//  120-660 ms  menu bar, dock, windows are revealed
// Ease-out curves, no bounce, no overshoot.
// ---------------------------------------------------------------------------
function unlockTransition(shield, dialog, extension, done, slow = 1) {
    const ms = v => Math.round(v * slow);
    const group = shield._lockDialogGroup;
    const OUT = Clutter.AnimationMode.EASE_OUT_QUAD;

    // The desktop underneath starts hidden, then is revealed.
    hideDesktop(extension);

    if (dialog) {
        const fadeOut = (actor, extra = {}) => actor?.ease({opacity: 0, duration: ms(220), mode: OUT, ...extra});
        if (dialog._promptBox) {
            dialog._promptBox.set_pivot_point(0.5, 0.5);
            dialog._promptBox.ease({opacity: 0, scale_x: 0.97, scale_y: 0.97, duration: ms(220), mode: OUT});
        }
        fadeOut(dialog._gnomacRest);
        fadeOut(dialog._otherUserButton);
        dialog._clock?.ease({opacity: 0, translation_y: -10, duration: ms(240), delay: ms(40), mode: OUT});

        // Wallpaper: blur and dimming ease out together with the UI.
        const widgets = [...(dialog._backgroundGroup ?? [])];
        const starts = widgets.map(w => {
            const effect = w.get_effect('blur');
            return effect ? {effect, radius: effect.radius, brightness: effect.brightness} : null;
        }).filter(Boolean);
        if (starts.length) {
            const timeline = new Clutter.Timeline({actor: group, duration: ms(520)});
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
    group.ease({opacity: 0, duration: ms(380), delay: ms(140), mode: OUT});

    revealDesktop(extension, {slow, onDone: () => {
        done();
        // The next lock starts from a clean layer.
        group.remove_all_transitions();
        group.opacity = 255;
        group.translation_y = 0;
        group.set_scale(1, 1);
    }});
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
                // Leaving the unlock-dialog mode rebuilds the desktop modules.
                if (Main.sessionMode.currentMode === 'unlock-dialog')
                    Main.sessionMode.popMode('unlock-dialog');
                this.emit('wake-up-screen');
                dialog?.popModal();
                if (this._grab) {
                    Main.popModal(this._grab);
                    this._grab = null;
                }
                this._longLightbox.lightOff();
                this._shortLightbox.lightOff();
                unlockTransition(this, dialog, extension, () => this._completeDeactivate(),
                    Number(globalThis.GNOMAC_UNLOCK_SPEED) || 1);
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
