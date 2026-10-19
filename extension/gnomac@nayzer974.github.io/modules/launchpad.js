// Launchpad: full-screen app grid over frosted glass, opened from the dock's
// Applications button (or Super+A when enabled). Paged grid with dots,
// spring paging (scroll, arrows, swipe-like wheel), type-to-search, and the
// macOS zoom-in/zoom-out when it opens and closes.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface} from '../lib/glass.js';
import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const COLUMNS = 7;
const ROWS = 5;
const PER_PAGE = COLUMNS * ROWS;

const AppTile = GObject.registerClass({
    Signals: {'activate': {}},
}, class AppTile extends St.BoxLayout {
    _init(app, iconSize) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-launchpad-tile',
            reactive: true,
            track_hover: true,
        });
        this.app = app;
        const icon = app.create_icon_texture(iconSize);
        icon.x_align = Clutter.ActorAlign.CENTER;
        this.add_child(icon);
        const label = new St.Label({
            text: app.get_name(),
            style_class: 'gnomac-launchpad-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(label);
        this.set_pivot_point(0.5, 0.5);
        this.connect('button-release-event', (_a, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY)
                this.emit('activate');
            return Clutter.EVENT_STOP;
        });
    }
});

export class Launchpad {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._tick = dt => this._onTick(dt);
        this._root = null;
    }

    enable() {
        this._extension.launchpad = this;
    }

    disable() {
        this.close(false);
        if (this._extension.launchpad === this)
            this._extension.launchpad = null;
    }

    toggle() {
        if (this._root)
            this.close();
        else
            this.open();
    }

    open() {
        if (Main.overview.visible)
            Main.overview.hide();
        const monitor = Main.layoutManager.primaryMonitor;
        this._monitor = monitor;
        this._iconSize = Math.max(56, Math.min(96, Math.floor(monitor.height / 9)));

        this._root = new St.Widget({
            name: 'gnomacLaunchpad',
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });

        this._glass = new GlassSurface({
            backdrop: 'windows',
            blur: 60,
            glass: {radius: 0, refraction: 0, thickness: 1, chroma: 0, rim: 0, sheen: 0,
                tint: [0.05, 0.05, 0.07, 0.35]},
        });
        this._glass.set_size(monitor.width, monitor.height);
        this._root.add_child(this._glass);
        this._glass.setStageOrigin(monitor.x, monitor.y);

        this._entry = new St.Entry({
            style_class: 'gnomac-launchpad-search',
            hint_text: t('Search', 'Rechercher'),
            can_focus: true,
        });
        this._entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', style_class: 'gnomac-launchpad-search-icon'}));
        this._root.add_child(this._entry);

        // The viewport zooms as a whole; the pages slide inside it.
        this._viewport = new St.Widget({width: monitor.width, height: monitor.height});
        this._viewport.set_pivot_point(0.5, 0.5);
        this._pages = new St.Widget();
        this._viewport.add_child(this._pages);
        this._root.add_child(this._viewport);
        this._dots = new St.BoxLayout({style_class: 'gnomac-launchpad-dots'});
        this._root.add_child(this._dots);

        Main.layoutManager.uiGroup.add_child(this._root);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        global.stage.set_key_focus(this._entry.clutter_text);

        this._root.connect('button-release-event', (actor, event) => {
            // Clicking the empty glass closes, like macOS.
            if (global.stage.get_event_actor(event) === actor ||
                global.stage.get_event_actor(event) === this._glass)
                this.close();
            return Clutter.EVENT_STOP;
        });
        this._root.connect('scroll-event', (_a, event) => this._onScroll(event));
        this._entry.clutter_text.connect('text-changed', () => this._fill());
        this._entry.clutter_text.connect('key-press-event', (_a, event) => this._onKey(event));
        this._entry.clutter_text.connect('activate', () => {
            const first = this._tiles?.[0];
            if (first)
                this._launch(first.app);
        });

        this._page = 0;
        this._offset = new Spring({stiffness: 260, damping: 30, value: 0});
        this._zoom = new Spring({stiffness: 320, damping: 26, value: 1.12});
        this._zoom.setTarget(1);
        this._root.opacity = 0;
        this._root.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        this._fill();
        getTicker().add(this._tick);
    }

    _apps() {
        const appSystem = Shell.AppSystem.get_default();
        const query = this._entry.text.trim().toLowerCase();
        if (query) {
            return Shell.AppSystem.search(query).flat()
                .map(id => appSystem.lookup_app(id))
                .filter(app => app && app.app_info?.should_show());
        }
        return appSystem.get_installed()
            .filter(info => info.should_show())
            .map(info => appSystem.lookup_app(info.get_id()))
            .filter(Boolean)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
    }

    _fill() {
        this._pages.destroy_all_children();
        this._dots.destroy_all_children();
        const monitor = this._monitor;
        const apps = this._apps();
        const pageCount = Math.max(1, Math.ceil(apps.length / PER_PAGE));
        const gridWidth = monitor.width * 0.78;
        const gridTop = 130;
        const gridHeight = monitor.height - gridTop - 110;
        const cellW = gridWidth / COLUMNS;
        const cellH = gridHeight / ROWS;
        const left = (monitor.width - gridWidth) / 2;

        this._tiles = [];
        apps.forEach((app, i) => {
            const page = Math.floor(i / PER_PAGE);
            const slot = i % PER_PAGE;
            const tile = new AppTile(app, this._iconSize);
            tile.set_width(Math.round(cellW));
            tile.set_position(
                Math.round(page * monitor.width + left + (slot % COLUMNS) * cellW),
                Math.round(gridTop + Math.floor(slot / COLUMNS) * cellH));
            tile.connect('activate', () => this._launch(app));
            this._pages.add_child(tile);
            this._tiles.push(tile);
        });

        for (let i = 0; i < pageCount; i++) {
            const dot = new St.Button({style_class: 'gnomac-launchpad-dot', can_focus: false});
            dot.connect('clicked', () => this._goTo(i));
            this._dots.add_child(dot);
        }
        this._pageCount = pageCount;
        this._goTo(Math.min(this._page, pageCount - 1));
        this._layoutChrome();
    }

    _layoutChrome() {
        const monitor = this._monitor;
        const entryWidth = 260;
        this._entry.set_width(entryWidth);
        this._entry.set_position(Math.round((monitor.width - entryWidth) / 2), 48);
        const [, dotsWidth] = this._dots.get_preferred_width(-1);
        this._dots.set_position(Math.round((monitor.width - dotsWidth) / 2), monitor.height - 70);
        this._dots.visible = this._pageCount > 1;
    }

    _goTo(page) {
        this._page = Math.max(0, Math.min(page, this._pageCount - 1));
        this._offset.setTarget(-this._page * this._monitor.width);
        this._dots.get_children().forEach((dot, i) => {
            if (i === this._page)
                dot.add_style_pseudo_class('checked');
            else
                dot.remove_style_pseudo_class('checked');
        });
        getTicker().add(this._tick);
    }

    _onScroll(event) {
        const now = Date.now();
        if (this._lastScroll && now - this._lastScroll < 350)
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
            if (Math.abs(d) > 0.4)
                delta = Math.sign(d);
        }
        if (delta) {
            this._lastScroll = now;
            this._goTo(this._page + delta);
        }
        return Clutter.EVENT_STOP;
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) {
            if (this._entry.text)
                this._entry.text = '';
            else
                this.close();
            return Clutter.EVENT_STOP;
        }
        if (!this._entry.text && (key === Clutter.KEY_Right || key === Clutter.KEY_Page_Down)) {
            this._goTo(this._page + 1);
            return Clutter.EVENT_STOP;
        }
        if (!this._entry.text && (key === Clutter.KEY_Left || key === Clutter.KEY_Page_Up)) {
            this._goTo(this._page - 1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _launch(app) {
        this.close();
        app.activate();
    }

    _onTick(dt) {
        if (!this._root)
            return false;
        this._offset.step(dt);
        this._zoom.step(dt);
        this._pages.set_position(Math.round(this._offset.value), 0);
        // The grid zooms in from slightly larger, as macOS does.
        const z = this._zoom.value;
        this._viewport.set_scale(z, z);
        return !(this._offset.settled && this._zoom.settled);
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
        this._tiles = [];
        if (!animate) {
            root.destroy();
            return;
        }
        this._viewport.ease({
            scale_x: 1.08,
            scale_y: 1.08,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
        root.ease({
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => root.destroy(),
        });
    }
}
