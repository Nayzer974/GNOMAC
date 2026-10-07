// The desktop is REVEALED, not faded in: shared by the unlock transition and
// the start-up. Short and damped, no bounce, no overshoot:
//
//   window layer   120 ms → +420 ms  opacity, 98.5 % → 100 %
//   menu bar       160 ms → +380 ms  opacity, settles down 8 px
//   dock           210 ms → +450 ms  opacity, rises 24 px, 97 % → 100 %,
//                                    its glass materialises (optics settle)
//
// Reveal ends 660 ms after it starts; nothing moves afterwards.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TOKENS} from './glassTokens.js';

const OUT = Clutter.AnimationMode.EASE_OUT_CUBIC;

export const REVEAL_MS = 660;

const dockOf = extension => extension._modules?.find(m => m.constructor.name === 'Dock') ?? null;

// Everything the reveal will animate starts hidden.
export function hideDesktop(extension) {
    Main.panel.remove_all_transitions();
    Main.panel.opacity = 0;
    Main.panel.translation_y = -8;
    const dock = dockOf(extension)?.actor;
    if (dock) {
        dock.remove_all_transitions();
        dock.opacity = 0;
        dock.translation_y = 24;
        dock.set_pivot_point(0.5, 1);
        dock.set_scale(0.97, 0.97);
    }
    global.window_group.remove_all_transitions();
    global.window_group.opacity = 0;
    global.window_group.set_pivot_point(0.5, 0.5);
    global.window_group.set_scale(0.985, 0.985);
}

// `slow` stretches every duration (tests). Instant with reduced motion.
export function revealDesktop(extension, {slow = 1, onDone = null} = {}) {
    const animate = St.Settings.get().enable_animations;
    const dock = dockOf(extension);
    const settle = () => {
        Main.panel.opacity = 255;
        Main.panel.translation_y = 0;
        global.window_group.opacity = 255;
        global.window_group.set_scale(1, 1);
        if (dock?.actor) {
            dock.actor.opacity = 255;
            dock.actor.translation_y = 0;
            dock.actor.set_scale(1, 1);
        }
        onDone?.();
    };
    if (!animate) {
        settle();
        return;
    }
    const ms = v => Math.round(v * slow);

    global.window_group.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: ms(420), delay: ms(120), mode: OUT});
    Main.panel.ease({opacity: 255, translation_y: 0, duration: ms(380), delay: ms(160), mode: OUT});
    if (dock?.actor) {
        dock.actor.ease({opacity: 255, translation_y: 0, scale_x: 1, scale_y: 1, duration: ms(450),
            delay: ms(210), mode: OUT});
        // The dock's glass forms with its optics settling.
        try {
            dock._glass?.materialize({duration: ms(TOKENS.animationSlow)});
        } catch {}
    }
    // One timer for the whole reveal, then everything is pinned to its end
    // state so nothing keeps moving. A plain timeout: a Clutter timeline tied
    // to an actor can be stopped by the mode change that precedes it.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms(REVEAL_MS), () => {
        settle();
        return GLib.SOURCE_REMOVE;
    });
}
