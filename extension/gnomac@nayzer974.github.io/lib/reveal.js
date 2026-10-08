// The desktop is REVEALED in two beats, shared by the unlock transition and the
// start-up:
//
//   1. BLUR → NORMAL   the wallpaper comes out of a heavy blur and sharpens
//                      (about 480 ms, ease-out) while the windows fade in,
//   2. ELEMENTS        then each element settles in, one after another:
//                        menu bar          from 220 ms   (opacity, 8 px down)
//                        dock plate        from 260 ms   (opacity, 24 px up, glass forms)
//                        dock icons        from 320 ms   (one every 38 ms, rise 10 px)
//                        widgets           from 400 ms   (one every 45 ms, rise 14 px)
//                        desktop icons     from 440 ms   (one every 35 ms, rise 14 px)
//
// Ease-out only, no bounce, no overshoot. When it ends nothing moves and the
// temporary blur effects are removed (no standing cost).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TOKENS} from './glassTokens.js';

const OUT = Clutter.AnimationMode.EASE_OUT_CUBIC;
const BLUR_RADIUS = 30;
const BLUR_MS = 480;
const EFFECT_NAME = 'gnomac-reveal-blur';

const dockOf = extension => extension._modules?.find(m => m.constructor.name === 'Dock') ?? null;
const tilesOf = (extension, owner) => (owner === 'widgets' ? extension.widgets?._tiles : extension.desktopIcons?.tiles) ?? [];
// Containers such as the window group have no size of their own (a blur on them
// asks Cogl for an empty texture): the blur goes on the wallpaper actors.
const blurTargets = () => (Main.layoutManager._bgManagers ?? []).map(m => m.backgroundActor).filter(Boolean);

export function removeRevealBlur() {
    blurTimeline?.stop();
    blurTimeline = null;
    for (const actor of blurTargets()) {
        try {
            actor.remove_effect_by_name(EFFECT_NAME);
        } catch {}
    }
}

// Everything the reveal will animate starts hidden, and blurred.
export function hideDesktop(extension) {
    Main.panel.remove_all_transitions();
    Main.panel.opacity = 0;
    Main.panel.translation_y = -8;

    const dock = dockOf(extension);
    if (dock?.actor) {
        dock.actor.remove_all_transitions();
        dock.actor.opacity = 0;
        dock.actor.translation_y = 24;
        dock.actor.set_pivot_point(0.5, 1);
        dock.actor.set_scale(0.97, 0.97);
        for (const item of dock._items ?? []) {
            item.remove_all_transitions();
            item.opacity = 0;
            item.translation_y = 10;
        }
    }
    for (const owner of ['widgets', 'icons']) {
        for (const tile of tilesOf(extension, owner)) {
            tile.actor.remove_all_transitions();
            tile.actor.opacity = 0;
            tile.actor.translation_y = 14;
        }
    }

    global.window_group.remove_all_transitions();
    global.window_group.opacity = 0;

    // The blur: the wallpaper starts heavily blurred.
    removeRevealBlur();
    for (const actor of blurTargets()) {
        actor.add_effect_with_name(EFFECT_NAME, new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR,
            radius: BLUR_RADIUS, brightness: 0.92}));
    }
}

// Everything at its final state, the temporary blur removed (also used by the
// start-up when it ends or is skipped).
export function settleDesktop(extension) {
    settleAll(extension);
}

function settleAll(extension) {
    removeRevealBlur();
    Main.panel.remove_all_transitions();
    Main.panel.opacity = 255;
    Main.panel.translation_y = 0;
    global.window_group.remove_all_transitions();
    global.window_group.opacity = 255;
    const dock = dockOf(extension);
    if (dock?.actor) {
        dock.actor.remove_all_transitions();
        dock.actor.opacity = 255;
        dock.actor.translation_y = 0;
        dock.actor.set_scale(1, 1);
        for (const item of dock._items ?? []) {
            item.remove_all_transitions();
            item.opacity = 255;
            item.translation_y = 0;
        }
    }
    for (const owner of ['widgets', 'icons']) {
        for (const tile of tilesOf(extension, owner)) {
            tile.actor.remove_all_transitions();
            tile.actor.opacity = 255;
            tile.actor.translation_y = 0;
            tile.actor.set_scale(tile.actor.scale_x > 0 ? tile.actor.scale_x : 1, tile.actor.scale_y > 0 ? tile.actor.scale_y : 1);
        }
    }
}

let active = null;
let blurTimeline = null;

// The reveal in progress, if any: its end timer is dropped and its owner is
// told it is over (an unlock must always complete).
function finishActiveReveal() {
    blurTimeline?.stop();
    blurTimeline = null;
    const reveal = active;
    active = null;
    if (!reveal)
        return;
    if (reveal.timer)
        GLib.source_remove(reveal.timer);
    reveal.onDone?.();
}

// The wallpaper comes out of its blur over `duration` ms, after `delay`. The
// effects are driven by one timeline on the stage, never on an actor the mode
// change could stop. A new radius means blurring the whole wallpaper again, the
// costliest thing here: while the blur is wide it changes in steps of 3 px
// (invisible), only near sharp does it follow pixel by pixel.
export function unblurWallpaper(duration, delay = 0) {
    const effects = blurTargets().map(a => a.get_effect(EFFECT_NAME)).filter(Boolean);
    blurTimeline?.stop();
    if (!effects.length)
        return;
    // From wherever the blur is now (a reveal cut short by a skip must not jump
    // back to the full blur).
    const fromRadius = Math.max(...effects.map(effect => effect.radius));
    const fromBrightness = Math.min(...effects.map(effect => effect.brightness));
    const timeline = new Clutter.Timeline({actor: global.stage, duration: Math.max(1, duration), delay});
    blurTimeline = timeline;
    let lastRadius = -1;
    timeline.connect('new-frame', () => {
        const eased = 1 - (1 - timeline.get_progress()) ** 3;
        const wide = Math.max(0, Math.round(fromRadius * (1 - eased)));
        const radius = wide > 12 ? Math.round(wide / 3) * 3 : wide;
        for (const effect of effects) {
            if (radius !== lastRadius)
                effect.radius = radius;
            effect.brightness = fromBrightness + (1 - fromBrightness) * eased;
        }
        lastRadius = radius;
    });
    timeline.connect('completed', () => {
        if (blurTimeline === timeline)
            blurTimeline = null;
    });
    timeline.start();
}

// `slow` stretches every duration (tests). Instant with reduced motion.
// Returns the total duration in ms (already scaled).
export function revealDesktop(extension, {slow = 1, onDone = null} = {}) {
    // A reveal still running is finished first (its owner is told), never left
    // with a timer that would cut the new one short.
    finishActiveReveal();
    const animate = St.Settings.get().enable_animations;
    if (!animate) {
        settleAll(extension);
        onDone?.();
        return 0;
    }
    const ms = v => Math.round(v * slow);
    let end = 0;
    const plan = (delay, duration) => {
        end = Math.max(end, delay + duration);
        return {delay: ms(delay), duration: ms(duration), mode: OUT};
    };

    // 1. Blur -> normal.
    unblurWallpaper(ms(BLUR_MS));
    end = ms(BLUR_MS);
    global.window_group.ease({opacity: 255, ...plan(100, 400)});

    // 2. Elements, one after another.
    Main.panel.ease({opacity: 255, translation_y: 0, ...plan(220, 380)});

    const dock = dockOf(extension);
    if (dock?.actor) {
        dock.actor.ease({opacity: 255, translation_y: 0, scale_x: 1, scale_y: 1, ...plan(260, 420)});
        try {
            dock._glass?.materialize({duration: ms(TOKENS.animationSlow)});
        } catch {}
        (dock._items ?? []).forEach((item, i) => {
            item.ease({opacity: 255, translation_y: 0, ...plan(320 + i * 38, 340)});
        });
    }
    const cascade = (tiles, from, step) => {
        tiles.forEach((tile, i) => {
            tile.actor.set_pivot_point(0.5, 0.5);
            const scale = tile.actor.scale_x || 1;
            tile.actor.ease({opacity: 255, translation_y: 0, scale_x: scale, scale_y: scale, ...plan(from + i * step, 380)});
        });
    };
    cascade(tilesOf(extension, 'widgets'), 400, 45);
    cascade(tilesOf(extension, 'icons'), 440, 35);

    // One timer for the end: everything is pinned to its final state and the
    // blur effects are removed, so nothing keeps moving or costing anything.
    const reveal = {onDone, timer: 0};
    reveal.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, end + 80, () => {
        reveal.timer = 0;
        if (active === reveal)
            active = null;
        settleAll(extension);
        onDone?.();
        return GLib.SOURCE_REMOVE;
    });
    active = reveal;
    return end;
}
