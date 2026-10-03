// macOS-style dock: floating Liquid Glass pane, gaussian magnification that
// pushes neighbours apart (like the real dock, unlike a plain scale), launch
// bounce, running dots, tooltips and the stock GNOME app context menu.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const SIGMA = 1.05; // magnification falloff, in icon slots
const BOUNCE_PERIOD = 0.6; // seconds per hop
const BOUNCE_TIMEOUT = 8; // give up bouncing after this many seconds
const FLOAT_MARGIN = 8;

const DockItem = GObject.registerClass(
class DockItem extends St.Widget {
    _init(dock, app) {
        super._init({
            style_class: 'gnomac-dock-item',
            reactive: true,
            track_hover: true,
        });
        this.dock = dock;
        this.app = app;
        this.lift = 0;
        this.bounceStart = -1;
        this.stopBounce = false;
        this.menu = null;

        this.icon = app
            ? app.create_icon_texture(dock.renderSize)
            : new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                icon_size: dock.renderSize,
                style_class: 'gnomac-dock-apps-icon',
            });
        this.icon.set_pivot_point(0.5, 1.0);
        this.add_child(this.icon);

        this.dot = new St.Widget({style_class: 'gnomac-dock-dot', visible: false});
        this.add_child(this.dot);

        this.connect('button-release-event', (_actor, event) => this._onRelease(event));
        this.connect('notify::hover', () => dock.onItemHover(this));
        this.connect('destroy', () => {
            this.menu?.destroy();
            this.menu = null;
        });
    }

    get name() {
        return this.app ? this.app.get_name() : t('Applications', 'Applications');
    }

    get running() {
        return !!this.app && this.app.state !== Shell.AppState.STOPPED;
    }

    place(width, height, iconBottom, scale, dotY) {
        this.set_size(Math.round(width), Math.round(height));
        const size = this.dock.renderSize;
        this.icon.set_position(Math.round((width - size) / 2), Math.round(iconBottom - size));
        const s = scale / this.dock.maxScale;
        this.icon.set_scale(s, s);
        this.icon.translation_y = -this.lift;
        this.dot.visible = this.running && this.dock.showRunning;
        const [, dotWidth] = this.dot.get_preferred_width(-1);
        this.dot.set_position(Math.round((width - dotWidth) / 2), Math.round(dotY));
    }

    _onRelease(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            this.dock.openMenu(this);
            return Clutter.EVENT_STOP;
        }
        if (Main.overview.visible)
            Main.overview.hide();
        if (!this.app) {
            Main.overview.showApps();
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_MIDDLE) {
            this.dock.bounce(this);
            this.app.open_new_window(-1);
        } else if (button === Clutter.BUTTON_PRIMARY) {
            if (!this.running)
                this.dock.bounce(this);
            this.app.activate();
        }
        return Clutter.EVENT_STOP;
    }
});

export class Dock {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._signals = [];
        this._items = [];
        this._separators = [];
        this._pointerX = null;
        this._expanded = false;
        this._hoveredItem = null;
        this._ticking = false;
        this._tick = dt => this._onTick(dt);
    }

    enable() {
        const s = this._settings;
        this.base = s.get_int('dock-icon-size');
        this.magnify = s.get_boolean('dock-magnification');
        this.maxScale = this.magnify ? s.get_double('dock-max-scale') : 1.0;
        this.renderSize = Math.round(this.base * this.maxScale);
        this.showRunning = s.get_boolean('dock-show-running');
        this._pad = Math.round(this.base * 0.16);
        this._spacing = Math.round(this.base * 0.12);
        this._glassHeight = this.base + 2 * this._pad;
        this._radius = Math.round(this._glassHeight * 0.42);

        this._hover = new Spring({
            stiffness: s.get_double('spring-stiffness'),
            damping: s.get_double('spring-damping'),
        });

        this.actor = new St.Widget({
            name: 'gnomacDock',
            reactive: true,
            track_hover: true,
        });
        this._glass = new GlassSurface({
            blur: s.get_int('glass-blur'),
            glass: glassParamsFromSettings(s, this._radius),
        });
        this.actor.add_child(this._glass);

        this._tooltip = new St.Label({style_class: 'gnomac-dock-tooltip', opacity: 0});
        Main.layoutManager.addTopChrome(this._tooltip, {affectsInputRegion: false});

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        if (s.get_boolean('dock-reserve-space')) {
            this._strut = new St.Widget({reactive: false});
            Main.layoutManager.addChrome(this._strut, {
                affectsStruts: true,
                affectsInputRegion: false,
                trackFullscreen: true,
            });
        }

        this.actor.connect('motion-event', (_actor, event) => {
            [this._pointerX] = event.get_coords();
            this._kick();
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('notify::hover', () => this._onDockHover());

        const appSystem = Shell.AppSystem.get_default();
        this._connect(AppFavorites.getAppFavorites(), 'changed', () => this._rebuild());
        this._connect(appSystem, 'installed-changed', () => this._rebuild());
        this._connect(appSystem, 'app-state-changed', (_sys, app) => this._onAppState(app));
        this._connect(Main.layoutManager, 'monitors-changed', () => this._relayout());
        this._connect(Main.overview, 'showing', () => this.actor.hide());
        this._connect(Main.overview, 'hidden', () => this.actor.show());

        this._rebuild();
    }

    disable() {
        getTicker().remove(this._tick);
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._items = [];
        this._separators = [];
        if (this._strut) {
            Main.layoutManager.removeChrome(this._strut);
            this._strut.destroy();
            this._strut = null;
        }
        Main.layoutManager.removeChrome(this._tooltip);
        this._tooltip.destroy();
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.actor = null;
        this._menuManager = null;
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _wantedApps() {
        const favorites = AppFavorites.getAppFavorites().getFavorites();
        const favoriteIds = new Set(favorites.map(app => app.get_id()));
        const running = Shell.AppSystem.get_default().get_running()
            .filter(app => !favoriteIds.has(app.get_id()));
        return {favorites, running};
    }

    _rebuild() {
        const {favorites, running} = this._wantedApps();
        const previous = new Map(this._items.filter(i => i.app).map(i => [i.app.get_id(), i]));
        const appsButton = this._items.find(i => !i.app);

        const take = app => {
            const id = app.get_id();
            const item = previous.get(id) ?? this._addItem(app);
            previous.delete(id);
            return item;
        };

        const items = favorites.map(take);
        const groups = [items.length];
        for (const app of running)
            items.push(take(app));
        groups.push(items.length);
        items.push(appsButton ?? this._addItem(null));

        for (const stale of previous.values())
            stale.destroy();
        for (const separator of this._separators)
            separator.destroy();

        // One separator after the favourites and one before the Applications
        // button, skipping empty groups.
        this._separators = [];
        this._separatorAfter = new Set();
        let last = -1;
        for (const end of groups) {
            if (end > 0 && end !== last && end < items.length) {
                this._separatorAfter.add(end - 1);
                const separator = new St.Widget({style_class: 'gnomac-dock-separator'});
                this.actor.add_child(separator);
                this._separators.push(separator);
            }
            last = end;
        }

        this._items = items;
        this._relayout();
    }

    _addItem(app) {
        const item = new DockItem(this, app);
        this.actor.add_child(item);
        return item;
    }

    _relayout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.actor)
            return;

        const base = this.base;
        const step = base + this._spacing;
        const separatorWidth = 1 + this._spacing;
        const items = this._items;
        const n = items.length;
        const separators = this._separatorAfter.size;

        const baseWidth = 2 * this._pad + n * base + (n - 1) * this._spacing +
            separators * separatorWidth;
        const center = monitor.x + monitor.width / 2;

        // Magnification is computed against the unmagnified layout so the
        // result does not feed back into itself.
        const hover = Math.max(0, this._hover.value);
        let cursor = center - baseWidth / 2 + this._pad;
        const scales = items.map((_item, i) => {
            const slotCenter = cursor + base / 2;
            cursor += step + (this._separatorAfter.has(i) ? separatorWidth : 0);
            if (!this.magnify || this._pointerX === null || hover <= 0)
                return 1;
            const distance = (this._pointerX - slotCenter) / step;
            return 1 + (this.maxScale - 1) * hover *
                Math.exp(-(distance * distance) / (2 * SIGMA * SIGMA));
        });

        const widths = scales.map(scale => base * scale);
        const width = 2 * this._pad + widths.reduce((a, b) => a + b, 0) +
            (n - 1) * this._spacing + separators * separatorWidth;

        const bouncing = items.some(item => item.bounceStart >= 0);
        const headroom = this._expanded || bouncing
            ? Math.ceil(base * (this.maxScale - 1) + base * 0.6 + 8)
            : 0;
        const height = FLOAT_MARGIN + this._glassHeight + headroom;

        const x = Math.round(center - width / 2);
        const y = monitor.y + monitor.height - height;
        this.actor.set_position(x, y);
        this.actor.set_size(Math.round(width), height);

        const glassY = height - FLOAT_MARGIN - this._glassHeight;
        this._glass.set_position(0, glassY);
        this._glass.set_size(Math.round(width), this._glassHeight);
        this._glass.setStageOrigin(x, y + glassY);

        const iconBottom = glassY + this._pad + base;
        const dotY = glassY + this._glassHeight - Math.max(4, this._pad * 0.45);
        let left = this._pad;
        let separatorIndex = 0;
        items.forEach((item, i) => {
            item.set_position(Math.round(left), 0);
            item.place(widths[i], glassY + this._glassHeight, iconBottom, scales[i], dotY);
            left += widths[i] + this._spacing;
            if (this._separatorAfter.has(i)) {
                const separator = this._separators[separatorIndex++];
                const separatorHeight = Math.round(base * 0.62);
                separator.set_size(1, separatorHeight);
                separator.set_position(Math.round(left - this._spacing / 2),
                    Math.round(glassY + (this._glassHeight - separatorHeight) / 2));
                left += separatorWidth;
            }
        });

        if (this._strut) {
            const reserved = this._glassHeight + FLOAT_MARGIN;
            this._strut.set_position(monitor.x, monitor.y + monitor.height - reserved);
            this._strut.set_size(monitor.width, reserved);
        }

        this._placeTooltip(scales);
    }

    _placeTooltip(scales) {
        const item = this._hoveredItem;
        if (!item || !this._items.includes(item))
            return;
        const i = this._items.indexOf(item);
        const [itemX, itemY] = item.get_transformed_position();
        const [labelWidth, labelHeight] = this._tooltip.get_size();
        const iconTop = itemY + item.height - this._pad - this.base * scales[i] - item.lift;
        this._tooltip.set_position(
            Math.round(itemX + item.width / 2 - labelWidth / 2),
            Math.round(iconTop - labelHeight - 10));
    }

    onItemHover(item) {
        if (item.hover) {
            this._hoveredItem = item;
            this._tooltip.text = item.name;
            this._tooltip.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else if (this._hoveredItem === item) {
            this._hoveredItem = null;
            this._tooltip.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        this._kick();
    }

    _onDockHover() {
        if (this.actor.hover) {
            this._expanded = true;
            this._hover.setTarget(1);
        } else {
            this._hover.setTarget(0);
        }
        this._kick();
    }

    _onAppState(app) {
        const item = this._items.find(i => i.app && i.app.get_id() === app.get_id());
        if (item && app.state === Shell.AppState.RUNNING)
            item.stopBounce = true;
        // Running apps outside the favourites appear and disappear.
        this._rebuild();
    }

    bounce(item) {
        if (item.bounceStart >= 0)
            return;
        item.bounceStart = GLib.get_monotonic_time();
        item.stopBounce = false;
        this._kick();
    }

    _updateBounce(item) {
        if (item.bounceStart < 0)
            return false;
        const elapsed = (GLib.get_monotonic_time() - item.bounceStart) / 1e6;
        const cycle = Math.floor(elapsed / BOUNCE_PERIOD);
        const phase = (elapsed % BOUNCE_PERIOD) / BOUNCE_PERIOD;
        // Finish the current hop before stopping, as macOS does.
        if ((item.stopBounce && cycle >= 1) || elapsed > BOUNCE_TIMEOUT) {
            if (phase < 0.1 || elapsed > BOUNCE_TIMEOUT + BOUNCE_PERIOD) {
                item.bounceStart = -1;
                item.lift = 0;
                return false;
            }
        }
        item.lift = Math.sin(Math.PI * phase) * this.base * 0.5;
        return true;
    }

    _kick() {
        if (this._ticking)
            return;
        this._ticking = true;
        getTicker().add(this._tick);
    }

    _onTick(dt) {
        if (!this.actor)
            return false;
        this._hover.step(dt);
        let bouncing = false;
        for (const item of this._items)
            bouncing = this._updateBounce(item) || bouncing;

        if (!this.actor.hover && this._hover.settled && this._hover.value === 0)
            this._expanded = false;

        this._relayout();

        const active = bouncing || !this._hover.settled;
        if (!active)
            this._ticking = false;
        return active;
    }

    openMenu(item) {
        if (!item.app)
            return;
        if (!item.menu) {
            item.menu = new AppMenu(item, St.Side.BOTTOM, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            item.menu.setApp(item.app);
            Main.uiGroup.add_child(item.menu.actor);
            this._menuManager.addMenu(item.menu);
        }
        this._tooltip.opacity = 0;
        item.menu.open(BoxPointer.PopupAnimation.FULL);
    }
}
