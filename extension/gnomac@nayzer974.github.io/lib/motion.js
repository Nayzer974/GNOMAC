// Apple-style micro-interactions shared by the island, widgets and menus.
//
// - press(): any button gets the iOS "press and spring back" feel: it
//   squeezes on press and returns with a hint of overshoot,
// - ColorChip: a toggle tile whose coloured layer fades in and out (CSS
//   cannot transition colours in St, so the colour is a second actor whose
//   opacity is animated), with a small pop on the icon,
// - cascade(): children enter one after another (scale + fade), as the
//   Dynamic Island does when its content changes.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Spring, getTicker} from './spring.js';

// macOS system colours.
export const COLORS = {
    blue: [0.039, 0.518, 1.0],
    purple: [0.749, 0.353, 0.949],
    orange: [1.0, 0.624, 0.039],
    indigo: [0.369, 0.361, 0.902],
    green: [0.188, 0.82, 0.345],
    red: [1.0, 0.271, 0.227],
    gray: [0.56, 0.56, 0.58],
};

export const css = ([r, g, b], alpha = 1) =>
    `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;

// ------------------------------------------------------------ press feel

export function press(actor, {down = 0.93, stiffness = 520, damping = 17} = {}) {
    const spring = new Spring({stiffness, damping, value: 1});
    actor.set_pivot_point(0.5, 0.5);
    let ticking = false;
    let dead = false;
    actor.connect('destroy', () => (dead = true));
    const tick = dt => {
        if (dead)
            return false;
        spring.step(dt);
        actor.set_scale(spring.value, spring.value);
        if (spring.settled) {
            actor.set_scale(1, 1);
            ticking = false;
            return false;
        }
        return true;
    };
    const go = target => {
        spring.setTarget(target);
        if (!ticking) {
            ticking = true;
            getTicker().add(tick);
        }
    };
    actor.connect('notify::pressed', () => go(actor.pressed ? down : 1));
    actor.connect('leave-event', () => go(1));
    actor.connect('destroy', () => getTicker().remove(tick));
    return actor;
}

// ------------------------------------------------------------ colour chip

// A lighter shade of a colour, towards white.
export const lighten = ([r, g, b], k = 0.2) => [r + (1 - r) * k, g + (1 - g) * k, b + (1 - b) * k];

export function colorChip({icon, label, color, onToggle}) {
    // A button holds ONE child (GNOME 51 enforces it): the fill and the column
    // share a container.
    const root = new St.Button({style_class: 'gnomac-chip', toggle_mode: true, can_focus: false, reactive: true});
    const body = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
    const fill = new St.Widget({style_class: 'gnomac-chip-fill', x_expand: true, y_expand: true,
        opacity: 0, style: `background-gradient-direction: vertical; background-gradient-start: ${css(lighten(color))}; background-gradient-end: ${css(color)};`});
    const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-chip-column',
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
    const image = new St.Icon({icon_name: icon, icon_size: 18, x_align: Clutter.ActorAlign.CENTER});
    image.set_pivot_point(0.5, 0.5);
    // Off, the icon carries a soft tint of its colour; on, the tile is filled and the icon is white.
    image.set_style(`color: ${css(lighten(color, 0.3))};`);
    column.add_child(image);
    // A long name ("Do Not Disturb") shortens with an ellipsis instead of
    // touching the edges of its tile.
    const name = new St.Label({text: label, style_class: 'gnomac-chip-label', x_align: Clutter.ActorAlign.CENTER});
    name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    column.add_child(name);
    body.add_child(fill);
    body.add_child(column);
    root.set_child(body);

    press(root);

    root.setActive = (active, animate = true) => {
        const target = active ? 255 : 0;
        if (animate && root.mapped) {
            fill.ease({opacity: target, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            // The icon pops when the tile lights up.
            image.set_scale(active ? 0.7 : 1.25, active ? 0.7 : 1.25);
            image.ease({scale_x: 1, scale_y: 1, duration: 360,
                mode: Clutter.AnimationMode.EASE_OUT_BACK});
        } else {
            fill.remove_all_transitions();
            fill.opacity = target;
        }
        image.set_style(active ? 'color: #ffffff;' : `color: ${css(lighten(color, 0.3))};`);
        root.checked = active;
        if (active)
            root.add_style_pseudo_class('active');
        else
            root.remove_style_pseudo_class('active');
    };
    root.connect('clicked', () => onToggle?.(root.checked));
    return root;
}

// ------------------------------------------------------------ cascade

// Children appear one after another: a short stagger of scale + fade.
export function cascade(actors, {delay = 28, duration = 260, from = 0.9} = {}) {
    actors.forEach((actor, i) => {
        if (!actor || actor.is_finalized?.())
            return;
        actor.remove_all_transitions();
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(from, from);
        actor.opacity = 0;
        actor.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            delay: i * delay,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    });
}

// A page slides in from the side it is "after", and fades.
export function slideIn(actor, direction = 1, distance = 28) {
    actor.remove_all_transitions();
    actor.translation_x = direction * distance;
    actor.opacity = 0;
    actor.ease({translation_x: 0, opacity: 255, duration: 280,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
}
