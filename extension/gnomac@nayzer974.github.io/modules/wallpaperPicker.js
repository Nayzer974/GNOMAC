// Wallpaper picker (RevoShell's coverflow): Super+W opens a dark full-screen
// carousel of wallpapers fanned out in 3D; arrows or the wheel move it on a
// spring, Enter applies. The new wallpaper is revealed by a circle growing
// from the centre of the screen, then handed to GNOME's settings.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const SHORTCUT_KEY = 'wallpaper-shortcut';
const CARD_W = 220;
const CARD_H = 300;
const STEP = 120;
const VISIBLE = 6;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const REVEAL_MS = 1100;
const REVEAL_DELAY_MS = 120; // let the image texture load first

const HOOK = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

// Circle mask: shows the actor only inside a growing radius.
const CircleReveal = GObject.registerClass(
class CircleReveal extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._size = this.get_uniform_location('size');
        this._radius = this.get_uniform_location('radius');
        this.setRadius(0);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(HOOK,
            'uniform vec2 size; uniform float radius;',
            `vec2 p = cogl_tex_coord_in[0].st * size - size * 0.5;
             float a = 1.0 - smoothstep(radius - 2.0, radius, length(p));
             cogl_color_out *= a;`,
            false);
    }

    setRadius(radius) {
        this.set_uniform_float(this._radius, 1, [radius]);
        this.queue_repaint();
    }

    vfunc_paint_target(node, ctx) {
        const actor = this.get_actor();
        if (actor)
            this.set_uniform_float(this._size, 2, [actor.width, actor.height]);
        super.vfunc_paint_target(node, ctx);
    }
});

function listWallpapers() {
    const home = GLib.get_home_dir();
    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? `${home}/Pictures`;
    const dirs = [`${pictures}/Wallpapers`, pictures, '/usr/share/backgrounds', '/usr/share/wallpapers'];
    const found = new Map();
    const scan = (path, depth) => {
        if (found.size >= 80)
            return;
        let enumerator;
        try {
            enumerator = Gio.File.new_for_path(path).enumerate_children(
                'standard::name,standard::type,standard::is-hidden', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return;
        }
        let info;
        while ((info = enumerator.next_file(null)) !== null && found.size < 80) {
            if (info.get_is_hidden())
                continue;
            const child = GLib.build_filenamev([path, info.get_name()]);
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                if (depth > 0)
                    scan(child, depth - 1);
            } else if (IMAGE.test(info.get_name())) {
                found.set(child, info.get_name());
            }
        }
        enumerator.close(null);
    };
    for (const dir of dirs)
        scan(dir, 2);
    return [...found.entries()].map(([path, name]) => ({path, name}));
}

export class WallpaperPicker {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._tick = dt => this._onTick(dt);
        this._extension = extension;
    }

    enable() {
        this._extension.wallpaperPicker = this;
        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL, () => this.toggle());
    }

    disable() {
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        this.close(false);
        this._reveal?.destroy();
        this._reveal = null;
        if (this._extension.wallpaperPicker === this)
            this._extension.wallpaperPicker = null;
    }

    toggle() {
        if (this._root)
            this.close();
        else
            this.open();
    }

    open() {
        const items = listWallpapers();
        const monitor = Main.layoutManager.primaryMonitor;
        this._monitor = monitor;
        this._items = items;

        this._root = new St.Widget({style_class: 'gnomac-wallpicker', reactive: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        this._stage = new St.Widget({width: monitor.width, height: monitor.height});
        this._root.add_child(this._stage);
        this._title = new St.Label({style_class: 'gnomac-wallpicker-title'});
        this._hint = new St.Label({style_class: 'gnomac-wallpicker-hint',
            text: t('← → choose · Enter apply · Esc close', '← → choisir · Entrée appliquer · Échap fermer')});
        this._root.add_child(this._title);
        this._root.add_child(this._hint);

        const current = this._currentUri();
        this._cards = items.map((item, i) => {
            const card = new St.Widget({
                style_class: 'gnomac-wallpicker-card',
                style: `background-image: url("file://${item.path}");`,
                width: CARD_W, height: CARD_H, reactive: true,
            });
            card.set_pivot_point(0.5, 0.5);
            card.connect('button-release-event', () => {
                if (i === this._index)
                    this._apply();
                else
                    this._goTo(i);
                return Clutter.EVENT_STOP;
            });
            this._stage.add_child(card);
            return card;
        });
        const start = Math.max(0, items.findIndex(item => `file://${item.path}` === current));
        this._index = start;
        this._offset = new Spring({stiffness: 260, damping: 28, value: start});
        this._fade = new Spring({stiffness: 300, damping: 30, value: 0});
        this._fade.setTarget(1);

        Main.layoutManager.uiGroup.add_child(this._root);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        global.stage.set_key_focus(this._root);
        this._root.connect('key-press-event', (_a, event) => this._onKey(event));
        this._root.connect('scroll-event', (_a, event) => this._onScroll(event));
        this._root.connect('button-release-event', (actor, event) => {
            if (global.stage.get_event_actor(event) === actor || global.stage.get_event_actor(event) === this._stage)
                this.close();
            return Clutter.EVENT_STOP;
        });

        if (!items.length)
            this._title.text = t('No wallpapers found in Pictures/Wallpapers', 'Aucun fond d’écran dans Images/Wallpapers');
        this._layout();
        getTicker().add(this._tick);
    }

    close(animate = true) {
        if (!this._root)
            return;
        getTicker().remove(this._tick);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const root = this._root;
        this._root = null;
        this._cards = [];
        if (!animate) {
            root.destroy();
            return;
        }
        root.ease({opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => root.destroy()});
    }

    _currentUri() {
        const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('color-scheme') === 'prefer-dark';
        return bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
    }

    _goTo(index) {
        if (!this._items.length)
            return;
        this._index = Math.max(0, Math.min(index, this._items.length - 1));
        this._offset.setTarget(this._index);
        getTicker().add(this._tick);
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape)
            this.close();
        else if (key === Clutter.KEY_Right || key === Clutter.KEY_Down)
            this._goTo(this._index + 1);
        else if (key === Clutter.KEY_Left || key === Clutter.KEY_Up)
            this._goTo(this._index - 1);
        else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space)
            this._apply();
        return Clutter.EVENT_STOP;
    }

    _onScroll(event) {
        const now = Date.now();
        if (this._lastScroll && now - this._lastScroll < 120)
            return Clutter.EVENT_STOP;
        const direction = event.get_scroll_direction();
        let delta = 0;
        if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT)
            delta = 1;
        else if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT)
            delta = -1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            if (Math.abs(d) > 0.3)
                delta = Math.sign(d);
        }
        if (delta) {
            this._lastScroll = now;
            this._goTo(this._index + delta);
        }
        return Clutter.EVENT_STOP;
    }

    _onTick(dt) {
        if (!this._root)
            return false;
        this._offset.step(dt);
        this._fade.step(dt);
        this._layout();
        return !(this._offset.settled && this._fade.settled);
    }

    // Coverflow: the focused card faces the viewer, the others fan out on
    // both sides, turned towards the centre and receding.
    _layout() {
        const monitor = this._monitor;
        const fade = this._fade.value;
        this._root.opacity = Math.round(255 * Math.min(1, fade));
        const cx = monitor.width / 2;
        const cy = monitor.height / 2 - 20;
        const offset = this._offset.value;
        this._cards.forEach((card, i) => {
            const d = i - offset;
            const ad = Math.abs(d);
            card.visible = ad <= VISIBLE;
            if (!card.visible)
                return;
            const side = Math.sign(d);
            const spread = ad < 1 ? d * (STEP + 80) : side * (STEP + 80 + (ad - 1) * STEP * 0.62);
            const scale = 1 - Math.min(ad, 1) * 0.18 - Math.max(0, ad - 1) * 0.05;
            card.set_position(Math.round(cx + spread * fade - CARD_W / 2), Math.round(cy - CARD_H / 2));
            card.set_scale(scale, scale);
            card.rotation_angle_y = -side * Math.min(ad, 1) * 38;
            card.opacity = Math.round(255 * Math.max(0, 1 - Math.max(0, ad - 2) * 0.25));
            // Nearer cards on top.
            card.z_position = -ad * 10;
        });
        const sorted = [...this._cards].sort((a, b) => a.z_position - b.z_position);
        for (const card of sorted)
            this._stage.set_child_above_sibling(card, null);

        const item = this._items[this._index];
        if (item)
            this._title.text = item.name.replace(IMAGE, '');
        const [, tw] = this._title.get_preferred_width(-1);
        this._title.set_position(Math.round(cx - tw / 2), Math.round(cy + CARD_H / 2 + 34));
        const [, hw] = this._hint.get_preferred_width(-1);
        this._hint.set_position(Math.round(cx - hw / 2), Math.round(cy + CARD_H / 2 + 66));
    }

    _apply() {
        const item = this._items[this._index];
        if (!item)
            return;
        this.close();
        this.reveal(item.path);
    }

    // The new wallpaper grows out of a circle in the middle of the screen,
    // over the old one and under the windows, then GNOME takes over.
    reveal(path) {
        const monitor = Main.layoutManager.primaryMonitor;
        this._reveal?.destroy();
        const overlay = new St.Widget({
            style: `background-image: url("file://${path}"); background-size: cover; background-position: center;`,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
        });
        const effect = new CircleReveal();
        overlay.add_effect(effect);
        global.window_group.insert_child_above(overlay, Main.layoutManager._backgroundGroup);
        this._reveal = overlay;

        const diagonal = Math.hypot(monitor.width, monitor.height) / 2 + 4;
        const timeline = new Clutter.Timeline({actor: overlay, duration: REVEAL_MS});
        timeline.connect('new-frame', () => {
            const p = timeline.get_progress();
            // Ease in and out so the circle is seen growing, not popping.
            const eased = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
            effect.setRadius(diagonal * eased);
        });
        timeline.connect('completed', () => {
            // A newer reveal replaced this one: it owns the wallpaper now.
            if (this._reveal !== overlay)
                return;
            const uri = Gio.File.new_for_path(path).get_uri();
            const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            bg.set_string('picture-uri', uri);
            bg.set_string('picture-uri-dark', uri);
            bg.set_string('picture-options', 'zoom');
            // Let GNOME load the new background before letting go.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                if (this._reveal === overlay) {
                    overlay.ease({opacity: 0, duration: 250,
                        onStopped: () => overlay.destroy()});
                    this._reveal = null;
                }
                return GLib.SOURCE_REMOVE;
            });
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, REVEAL_DELAY_MS, () => {
            if (this._reveal === overlay)
                timeline.start();
            return GLib.SOURCE_REMOVE;
        });
    }
}
