// Motion tokens: one set of durations and curves for the whole desktop, so a
// window, the dock, Spotlight, the island and a workspace change feel like one
// physical system. Everything is ease-out or critically damped: no bounce, no
// overshoot (the only exception, the dock's notification badge, is documented).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

export const MotionTokens = {
    micro: 120,    // a press, a highlight
    short: 180,    // a hover, a small reveal
    medium: 280,   // a window opening, a workspace change
    long: 420,     // a window travelling to or from the dock, a maximise
    system: 600,   // the unlock / start-up reveal
};

// t in 0..1 -> progress in 0..1. All are monotonic and end exactly at 1.
const SPRING_OMEGA = 8;
const springRaw = t => 1 - (1 + SPRING_OMEGA * t) * Math.exp(-SPRING_OMEGA * t);
const SPRING_END = springRaw(1);

export const Easing = {
    smooth: t => t * t * (3 - 2 * t),
    easeOut: t => 1 - (1 - t) ** 3,
    easeOutQuart: t => 1 - (1 - t) ** 4,
    easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    // A critically damped spring: fast start, soft landing, never overshoots.
    springSubtle: t => (t <= 0 ? 0 : t >= 1 ? 1 : springRaw(t) / SPRING_END),
    linear: t => t,
};

// The same curves as Clutter modes, for the places that still use actor.ease().
export const ClutterModes = {
    smooth: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    easeOut: Clutter.AnimationMode.EASE_OUT_CUBIC,
    easeOutQuart: Clutter.AnimationMode.EASE_OUT_QUART,
    easeInOut: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
    springSubtle: Clutter.AnimationMode.EASE_OUT_QUINT,
};

// Reduced motion: the desktop's "animations" switch (GNOME's Settings >
// Accessibility > Reduce animation). Durations become 0, which every motion
// treats as "jump to the end state"; travelling motions (a window flying to
// the dock) are replaced by a short fade.
export const reducedMotion = () => !St.Settings.get().enable_animations;

export const motionMs = ms => (reducedMotion() ? 0 : ms);
