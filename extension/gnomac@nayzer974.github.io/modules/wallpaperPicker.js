// Wallpaper picker (RevoShell's coverflow): Super+W opens a dark full-screen
// carousel of wallpapers fanned out in 3D; arrows or the wheel move it on a
// spring, Enter applies. The new wallpaper is revealed by a circle growing
// from the centre of the screen, then handed to GNOME's settings.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';
import {Easing} from '../lib/motionTokens.js';
import {LensEffect} from '../lib/lensEffect.js';

const SHORTCUT_KEY = 'wallpaper-shortcut';
const CARD_W = 220;
const CARD_H = 300;
const STEP = 120;
const VISIBLE = 6;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const REVEAL_MS = 850;
const CAROUSEL_Y = -20;              // the carousel sits 20 px above the middle of the screen
const START_RADIUS = CARD_W * 0.55; // the bubble starts as big as the chosen card
const SETTLE_ZOOM = 0.06;           // the new picture settles from 106 % to 100 %
const BG_FADE_MS = 1000; // GNOME's own wallpaper crossfade (background.js)

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
        const cy = monitor.height / 2 + CAROUSEL_Y;
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
        this.reveal(item.path, this._dismissForApply());
    }

    // The carousel hands over to the reveal: input is released at once, the
    // cards around the chosen one, the title and the hint leave, and the
    // chosen card and the dark backdrop stay until the bubble takes over (see
    // _growCircle). Returns what is left to dissolve.
    _dismissForApply() {
        getTicker().remove(this._tick);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const root = this._root;
        const chosen = this._cards[this._index];
        const others = this._cards.filter(card => card !== chosen);
        // It stays on screen a moment, but no longer takes clicks.
        root.reactive = false;
        this._root = null;
        this._cards = [];
        for (const actor of [...others, this._title, this._hint])
            actor?.ease({opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        // The chosen card is the bubble's seed: it grows a little, ready to burst.
        chosen?.ease({scale_x: chosen.scale_x * 1.04, scale_y: chosen.scale_y * 1.04, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        return {root, chosen};
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
    reveal(path, leaving = null) {
        this._endReveal();
        this._leaving = leaving;
        const monitor = Main.layoutManager.primaryMonitor;
        const cancellable = new Gio.Cancellable();
        this._loading = cancellable;
        this._loadCover(path, monitor, cancellable, image => {
            if (cancellable.is_cancelled())
                return;
            this._loading = null;
            if (!image || !St.Settings.get().enable_animations) {
                this._dropLeaving(true);
                this._applyWallpaper(path);
                return;
            }
            this._growCircle(path, monitor, image);
        });
    }

    // The carousel kept for the reveal: dissolved, or destroyed at once.
    _dropLeaving(animate) {
        const leaving = this._leaving;
        this._leaving = null;
        if (!leaving?.root)
            return;
        if (animate)
            leaving.root.ease({opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => leaving.root.destroy()});
        else
            leaving.root.destroy();
    }

    _endReveal() {
        this._dropLeaving(false);
        this._loading?.cancel();
        this._loading = null;
        for (const id of this._revealSources ?? [])
            GLib.source_remove(id);
        this._revealSources = [];
        if (this._revealTimeline) {
            this._revealTimeline.stop();
            this._revealTimeline = null;
        }
        this._disconnectBackgrounds();
        this._reveal?.destroy();
        this._reveal = null;
    }

    _disconnectBackgrounds() {
        for (const [manager, id] of this._bgChangedIds ?? []) {
            try {
                manager.disconnect(id);
            } catch {} // the manager went away with its monitor
        }
        this._bgChangedIds = null;
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

    // The chosen card bursts into a bubble of glass: a disc of the new picture
    // that starts as big as the card, at the card's place, and grows until it
    // covers the screen. Its rim bends the picture like a lens and casts a soft
    // shadow on the old wallpaper, the picture settles from 106 % to 100 % as
    // it lands, and while it grows the dark backdrop of the carousel lifts and
    // the card melts into it. Under the windows, over the old wallpaper.
    _growCircle(path, monitor, image) {
        const leaving = this._leaving;
        this._leaving = null;
        // The picture can be a little larger than the monitor (cover): the frame
        // clips it. The bubble is centred where the carousel's card is.
        const cx = monitor.width / 2;
        const cy = monitor.height / 2 + CAROUSEL_Y;
        const frame = new St.Widget({clip_to_allocation: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        const picture = new Clutter.Actor({content: image.content,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            x: Math.round((monitor.width - image.width) / 2), y: Math.round((monitor.height - image.height) / 2),
            width: Math.round(image.width), height: Math.round(image.height)});
        picture.set_pivot_point(0.5, 0.5);
        frame.add_child(picture);
        const effect = new LensEffect([cx - picture.x, cy - picture.y]);
        effect.setTint([0, 0, 0, 0]);
        effect.setShadow(0.32, 80);
        picture.add_effect(effect);
        global.window_group.insert_child_above(frame, Main.layoutManager._backgroundGroup);
        this._reveal = frame;

        // Far enough to cover the farthest corner, with the settle zoom's margin.
        const end = (Math.hypot(Math.max(cx, monitor.width - cx), Math.max(cy, monitor.height - cy)) + 8) *
            (1 + SETTLE_ZOOM);
        const start = START_RADIUS;
        // The backdrop and the card dissolve over the first part of the growth.
        if (leaving?.root) {
            leaving.root.ease({opacity: 0, duration: Math.round(REVEAL_MS * 0.55),
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onStopped: () => leaving.root.destroy()});
            leaving.chosen?.ease({opacity: 0, scale_x: leaving.chosen.scale_x * 1.25,
                scale_y: leaving.chosen.scale_y * 1.25, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }

        const timeline = new Clutter.Timeline({actor: frame, duration: REVEAL_MS});
        this._revealTimeline = timeline;
        timeline.connect('new-frame', () => {
            const p = timeline.get_progress();
            effect.setRadius(start + (end - start) * Easing.easeOut(p));
            // The shadow fades as the bubble leaves the screen.
            effect.setShadow(0.32 * (1 - Easing.easeInOut(Math.min(1, p * 1.25))), 80);
            const zoom = 1 + SETTLE_ZOOM * (1 - Easing.easeOutQuart(p));
            picture.set_scale(zoom, zoom);
        });
        timeline.connect('completed', () => {
            if (this._revealTimeline !== timeline)
                return;
            this._revealTimeline = null;
            // The bubble covers everything: no more shader, a plain texture.
            picture.remove_effect(effect);
            picture.set_scale(1, 1);
            // Listen first, then change the wallpaper.
            this._releaseWhenLoaded(frame);
            this._applyWallpaper(path);
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
            this._disconnectBackgrounds();
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
