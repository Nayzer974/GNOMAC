// Wallpaper picker (RevoShell's coverflow): Super+W opens a dark full-screen
// carousel of wallpapers fanned out in 3D; arrows or the wheel move it on a
// spring, Enter applies. The new wallpaper is revealed by a circle growing
// from the centre of the screen, then handed to GNOME's settings.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';
import {Easing} from '../lib/motionTokens.js';
import {GLSLEffect} from '../lib/shaderEffect.js';

const SHORTCUT_KEY = 'wallpaper-shortcut';
const CARD_W = 220;
const CARD_H = 300;
const STEP = 120;
const VISIBLE = 6;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const REVEAL_MS = 650;
const BG_FADE_MS = 1000; // GNOME's own wallpaper crossfade (background.js)

const HOOK = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

// Circle mask: shows the actor only inside a growing radius.
const CircleReveal = GObject.registerClass(
class CircleReveal extends GLSLEffect {
    _init() {
        super._init();
        this._size = this.get_uniform_location('size');
        this._radius = this.get_uniform_location('radius');
        this.setRadius(0);
    }

    buildPipeline() {
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
        this._endReveal();
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
    //
    // Kept cheap on purpose: the picture is decoded off the main loop, already
    // scaled to the monitor (a 4K JPEG decoded by the CSS background froze the
    // shell), uploaded once as a texture, and the circle is one shader pass over
    // that cached texture. GNOME gets ONE settings change (three changes made it
    // load the wallpaper three times), and the shader is dropped as soon as the
    // circle covers the screen.
    reveal(path) {
        this._endReveal();
        const monitor = Main.layoutManager.primaryMonitor;
        const cancellable = new Gio.Cancellable();
        this._loading = cancellable;
        this._loadCover(path, monitor, cancellable, image => {
            if (cancellable.is_cancelled())
                return;
            this._loading = null;
            if (!image || !St.Settings.get().enable_animations) {
                this._applyWallpaper(path);
                return;
            }
            this._growCircle(path, monitor, image);
        });
    }

    _endReveal() {
        this._loading?.cancel();
        this._loading = null;
        for (const id of this._revealSources ?? [])
            GLib.source_remove(id);
        this._revealSources = [];
        if (this._revealTimeline) {
            this._revealTimeline.stop();
            this._revealTimeline = null;
        }
        if (this._bgChangedIds) {
            for (const [manager, id] of this._bgChangedIds)
                manager.disconnect(id);
            this._bgChangedIds = null;
        }
        this._reveal?.destroy();
        this._reveal = null;
    }

    // Decodes `path` at the size that covers the monitor (like GNOME's "zoom"),
    // in a worker thread. `done` gets {content, width, height} or null.
    _loadCover(path, monitor, cancellable, done) {
        let info;
        try {
            info = GdkPixbuf.Pixbuf.get_file_info(path);
        } catch {
            info = null;
        }
        if (!info?.[0] || info[1] < 1 || info[2] < 1) {
            done(null);
            return;
        }
        const [, sourceW, sourceH] = info;
        const scale = monitor.geometry_scale ?? 1;
        const cover = Math.max(monitor.width * scale / sourceW, monitor.height * scale / sourceH);
        // Never decode above the picture's own size: the texture is stretched.
        const decode = Math.min(cover, 1);
        const image = {width: sourceW * cover / scale, height: sourceH * cover / scale};
        Gio.File.new_for_path(path).read_async(GLib.PRIORITY_DEFAULT, cancellable, (file, res) => {
            let stream;
            try {
                stream = file.read_finish(res);
            } catch {
                done(null);
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,
                Math.max(1, Math.round(sourceW * decode)), Math.max(1, Math.round(sourceH * decode)),
                false, cancellable, (_source, result) => {
                    try {
                        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(result);
                        stream.close(null);
                        const content = new St.ImageContent({
                            preferred_width: pixbuf.get_width(), preferred_height: pixbuf.get_height()});
                        content.set_bytes(pixbuf.read_pixel_bytes(),
                            pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                            pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_rowstride());
                        done({content, ...image});
                    } catch (e) {
                        if (!cancellable.is_cancelled())
                            logError(e, 'GNOMAC wallpaper picker: picture not loaded');
                        done(null);
                    }
                });
        });
    }

    _growCircle(path, monitor, image) {
        // The picture can be a little larger than the monitor (cover): the frame
        // clips it, the picture stays centred so the circle starts mid-screen.
        const frame = new St.Widget({clip_to_allocation: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        const picture = new Clutter.Actor({content: image.content,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            x: Math.round((monitor.width - image.width) / 2), y: Math.round((monitor.height - image.height) / 2),
            width: Math.round(image.width), height: Math.round(image.height)});
        frame.add_child(picture);
        const effect = new CircleReveal();
        picture.add_effect(effect);
        global.window_group.insert_child_above(frame, Main.layoutManager._backgroundGroup);
        this._reveal = frame;

        const diagonal = Math.hypot(image.width, image.height) / 2 + 4;
        const timeline = new Clutter.Timeline({actor: frame, duration: REVEAL_MS});
        this._revealTimeline = timeline;
        timeline.connect('new-frame', () => {
            effect.setRadius(diagonal * Easing.easeOut(timeline.get_progress()));
        });
        timeline.connect('completed', () => {
            if (this._revealTimeline !== timeline)
                return;
            this._revealTimeline = null;
            // The circle covers everything: no more shader, a plain texture.
            picture.remove_effect(effect);
            this._applyWallpaper(path);
            this._releaseWhenLoaded(frame);
        });
        timeline.start();
    }

    // One settings transaction, so GNOME loads the wallpaper once.
    _applyWallpaper(path) {
        const uri = Gio.File.new_for_path(path).get_uri();
        const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        bg.delay();
        bg.set_string('picture-options', 'zoom');
        bg.set_string('picture-uri', uri);
        bg.set_string('picture-uri-dark', uri);
        bg.apply();
    }

    // GNOME loads the new wallpaper, then crossfades it in over its own
    // BG_FADE_MS. The overlay shows the same picture, so it is dropped once
    // that is over (or after a fallback delay if GNOME never says).
    _releaseWhenLoaded(frame) {
        const later = (ms, fn) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._revealSources = this._revealSources.filter(source => source !== id);
                fn();
                return GLib.SOURCE_REMOVE;
            });
            this._revealSources.push(id);
        };
        let armed = false;
        const arm = delay => {
            if (armed)
                return;
            armed = true;
            later(delay, () => {
                if (this._reveal !== frame)
                    return;
                this._reveal = null;
                frame.ease({opacity: 0, duration: 200, onStopped: () => frame.destroy()});
            });
        };
        this._bgChangedIds = [];
        for (const manager of Main.layoutManager._bgManagers ?? []) {
            this._bgChangedIds.push([manager, manager.connect('changed', () => arm(BG_FADE_MS + 100))]);
        }
        later(BG_FADE_MS + 1600, () => arm(0));
    }
}
