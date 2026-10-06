// macOS-style dock: floating Liquid Glass pane, gaussian magnification that
// pushes neighbours apart (like the real dock, unlike a plain scale), launch
// bounce, running dots, tooltips and the stock GNOME app context menu.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {DownloadsStack, TrashWatcher, confirmEmptyTrash, downloadsDir, openTrash} from './dockExtras.js';
import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';
import {dockBaseSize} from '../lib/ui.js';

const SIGMA = 1.05; // magnification falloff, in icon slots
const BOUNCE_PERIOD = 0.6; // seconds per hop
const BOUNCE_TIMEOUT = 8; // give up bouncing after this many seconds
const FLOAT_MARGIN = 8;

// macOS Tahoe icon & widget styles, as RevoShell's dock offers them:
// "dark" dims and calms colours, "tinted" turns icons monochrome (the look
// of the showcase video), "clear" makes them pale and glassy.
function applyIconStyle(icon, style) {
    if (style === 'default')
        return;
    const desaturate = {dark: 0.35, tinted: 1.0, clear: 1.0}[style] ?? 0;
    if (desaturate)
        icon.add_effect(new Clutter.DesaturateEffect({factor: desaturate}));
    const bc = new Clutter.BrightnessContrastEffect();
    if (style === 'dark')
        bc.set_brightness_full(-0.22, -0.22, -0.22);
    else if (style === 'tinted')
        bc.set_brightness_full(-0.12, -0.12, -0.08);
    else if (style === 'clear')
        bc.set_brightness_full(0.18, 0.18, 0.2);
    bc.set_contrast(style === 'clear' ? -0.15 : 0.08);
    icon.add_effect(bc);
    if (style === 'clear')
        icon.opacity = 215;
}

const DockItem = GObject.registerClass(
class DockItem extends St.Widget {
    // kind: 'app', 'apps' (Launchpad), 'downloads' or 'trash'.
    _init(dock, app, kind = 'app') {
        super._init({
            style_class: 'gnomac-dock-item',
            reactive: true,
            track_hover: true,
        });
        this.dock = dock;
        this.app = app;
        this.kind = app ? 'app' : kind;
        this.lift = 0;
        this.bounceStart = -1;
        this.stopBounce = false;
        this.menu = null;
        this._delegate = this;

        if (app) {
            this.icon = app.create_icon_texture(dock.renderSize);
        } else {
            const names = {
                apps: 'view-app-grid-symbolic',
                downloads: 'folder-download',
                trash: dock.trashIconName,
            };
            this.icon = new St.Icon({
                icon_name: names[this.kind],
                icon_size: dock.renderSize,
                style_class: this.kind === 'apps' ? 'gnomac-dock-apps-icon' : 'gnomac-dock-special-icon',
            });
        }
        this.icon.set_pivot_point(0.5, 1.0);
        applyIconStyle(this.icon, dock.iconStyle);
        this.add_child(this.icon);

        if (app) {
            this._draggable = DND.makeDraggable(this, {dragActorMaxSize: dock.base * 1.2});
            this._draggable.connect('drag-begin', () => dock.onDragBegin(this));
            this._draggable.connect('drag-end', (_d, _time, accepted) => dock.onDragEnd(this, accepted));
        }

        this.dot = new St.Widget({style_class: 'gnomac-dock-dot', visible: false});
        this.add_child(this.dot);

        // Unread notification counter (red bubble on the icon's corner).
        this.badge = new St.Label({style_class: 'gnomac-dock-badge', visible: false});
        this.add_child(this.badge);
        this.badgeCount = 0;

        this.connect('button-release-event', (_actor, event) => this._onRelease(event));
        this.connect('notify::hover', () => dock.onItemHover(this));
        this.connect('destroy', () => {
            this.menu?.destroy();
            this.menu = null;
        });
    }

    get name() {
        if (this.app)
            return this.app.get_name();
        return {
            apps: t('Applications', 'Applications'),
            downloads: t('Downloads', 'Téléchargements'),
            trash: t('Trash', 'Corbeille'),
        }[this.kind];
    }

    // DND: what follows the pointer, and where it flies back from.
    getDragActor() {
        return this.app.create_icon_texture(Math.round(this.dock.base * 1.2));
    }

    getDragActorSource() {
        return this.icon;
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
        this._placeBadge(width, iconBottom, size, s);
    }

    setBadge(count) {
        if (count === this.badgeCount)
            return;
        const appeared = count > 0 && this.badgeCount === 0;
        this.badgeCount = count;
        this.badge.visible = count > 0;
        this.badge.text = count > 99 ? '99+' : String(count);
        if (appeared) {
            // The bubble pops in with a little overshoot.
            this.badge.set_pivot_point(0.5, 0.5);
            this.badge.set_scale(0.3, 0.3);
            this.badge.ease({scale_x: 1, scale_y: 1, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        }
    }

    _placeBadge(width, iconBottom, size, scale) {
        if (!this.badge.visible)
            return;
        const [, bw] = this.badge.get_preferred_width(-1);
        const [, bh] = this.badge.get_preferred_height(-1);
        const half = (size * scale) / 2;
        this.badge.set_position(Math.round(width / 2 + half - bw * 0.7),
            Math.round(iconBottom - size * scale - this.lift - bh * 0.3));
    }

    _onRelease(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            this.dock.openMenu(this);
            return Clutter.EVENT_STOP;
        }
        if (Main.overview.visible && this.kind !== 'apps')
            Main.overview.hide();
        if (this.kind === 'apps') {
            this.dock.openLaunchpad();
            return Clutter.EVENT_STOP;
        }
        if (this.kind === 'downloads') {
            this.dock.openDownloads(this);
            return Clutter.EVENT_STOP;
        }
        if (this.kind === 'trash') {
            openTrash();
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
        this.base = dockBaseSize(s);
        this.magnify = s.get_boolean('dock-magnification');
        this.maxScale = this.magnify ? s.get_double('dock-max-scale') : 1.0;
        this.renderSize = Math.round(this.base * this.maxScale);
        this.showRunning = s.get_boolean('dock-show-running');
        this.iconStyle = s.get_string('dock-icon-style');
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
        // Windows can be dragged behind the dock, so it shows them like macOS.
        this._glass = new GlassSurface({
            backdrop: 'windows',
            blur: s.get_int('glass-blur'),
            glass: glassParamsFromSettings(s, this._radius),
        });
        this.actor.add_child(this._glass);

        this._tooltip = new St.Label({style_class: 'gnomac-dock-tooltip', opacity: 0});
        // Not chrome: it must never take part in struts or fullscreen tracking.
        Main.layoutManager.uiGroup.add_child(this._tooltip);

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._trash = new TrashWatcher(() => {
            const item = this._items.find(i => i.kind === 'trash');
            if (item)
                item.icon.icon_name = this.trashIconName;
        });
        this._downloads = new DownloadsStack();
        this._dropIndex = -1;
        this._dragItem = null;
        this.actor._delegate = this;
        this._dragMonitor = {dragMotion: event => this._onDragMotion(event)};
        DND.addDragMonitor(this._dragMonitor);

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        if (s.get_boolean('dock-reserve-space')) {
            this._strut = new St.Widget({reactive: false});
            Main.layoutManager.addChrome(this._strut, {
                affectsStruts: true,
                trackFullscreen: true,
            });
        }

        this.actor.connect('motion-event', (_actor, event) => {
            [this._pointerX] = event.get_coords();
            this._kick();
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('notify::hover', () => this._onDockHover());
        this.actor.connect('destroy', () => (this._actorGone = true));

        const appSystem = Shell.AppSystem.get_default();
        this._connect(AppFavorites.getAppFavorites(), 'changed', () => this._rebuild());
        this._connect(appSystem, 'installed-changed', () => this._rebuild());
        this._connect(appSystem, 'app-state-changed', (_sys, app) => this._onAppState(app));
        // A new resolution changes the automatic size: rebuild with it.
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            if (dockBaseSize(this._settings) !== this.base)
                this._extension._scheduleReload?.();
            else
                this._relayout();
        });
        this._connect(global.display, 'window-created', () => this._queuePublish());
        // GNOME's dash would be a second dock in the overview.
        // Hidden with opacity, never with hide()/show():
        // toggling its visibility made GNOME rebuild its icons, leaving a
        // stack of orphaned "dash-label" tooltips in the UI group per reload.
        this._dash = Main.overview.dash;
        if (this._dash) {
            this._dashSaved = {opacity: this._dash.opacity, reactive: this._dash.reactive};
            this._dash.opacity = 0;
            this._dash.reactive = false;
            this._connect(this._dash, 'notify::opacity', () => {
                if (this._dash.opacity !== 0)
                    this._dash.opacity = 0;
            });
        }
        this._connect(Main.overview, 'showing', () => this.actor.hide());
        this._connect(Main.overview, 'hidden', () => this.actor.show());

        this._rebuild();
        if (s.get_boolean('dock-badges'))
            this._watchNotifications();
    }

    disable() {
        getTicker().remove(this._tick);
        this._unwatchNotifications();
        for (const puff of [...(this._poofs ?? [])])
            puff.destroy();
        this._poofs = null;
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._trash?.destroy();
        this._trash = null;
        this._downloads?.destroy();
        this._downloads = null;
        if (this._publishLater) {
            global.compositor.get_laters().remove(this._publishLater);
            this._publishLater = 0;
        }
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        if (this._dash && this._dashSaved && !this._dash.is_destroyed?.()) {
            this._dash.opacity = this._dashSaved.opacity;
            this._dash.reactive = this._dashSaved.reactive;
        }
        this._dash = null;
        this._items = [];
        this._separators = [];
        if (this._strut) {
            Main.layoutManager.removeChrome(this._strut);
            this._strut.destroy();
            this._strut = null;
        }
        this._tooltip?.destroy();
        this._tooltip = null;
        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
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
        const previous = new Map(this._items.map(i => [i.app ? i.app.get_id() : `@${i.kind}`, i]));
        const special = kind => {
            const item = previous.get(`@${kind}`) ?? this._addItem(null, kind);
            previous.delete(`@${kind}`);
            return item;
        };

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
        // macOS keeps Downloads and the Trash after the last separator.
        items.push(special('apps'));
        items.push(special('downloads'));
        items.push(special('trash'));

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
        this._queuePublish();
        if (this._watched)
            this._updateBadges();
    }

    _queuePublish() {
        if (this._publishLater)
            return;
        this._publishLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._publishLater = 0;
            this._publishIconGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    _addItem(app, kind = 'app') {
        const item = new DockItem(this, app, kind);
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

        // While an icon is dragged, its slot collapses and a gap opens where
        // it would land, so the other icons slide apart like macOS.
        const widths = scales.map((scale, i) => {
            if (items[i] === this._dragItem)
                return -this._spacing;
            return base * scale;
        });
        const gap = this._dropIndex >= 0 ? step : 0;
        const width = 2 * this._pad + widths.reduce((a, b) => a + b, 0) +
            (n - 1) * this._spacing + separators * separatorWidth + gap;

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
            if (i === this._dropIndex)
                left += gap;
            item.set_position(Math.round(left), 0);
            item.visible = item !== this._dragItem;
            item.place(Math.max(0, widths[i]), glassY + this._glassHeight, iconBottom, scales[i], dotY);
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
            // Same breathing room above the dock as on the screen sides.
            const reserved = this._glassHeight + FLOAT_MARGIN + this._settings.get_int('window-gap');
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
            // macOS 27: apps that run without any window say so.
            const background = item.app && item.app.state === Shell.AppState.RUNNING &&
                item.app.get_windows().length === 0;
            this._tooltip.text = background
                ? `${item.name}\n${t('Running in Background', 'Exécutée en arrière-plan')}`
                : item.name;
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

    // ---- notification counters -----------------------------------------

    _watchNotifications() {
        const tray = Main.messageTray;
        const watch = source => {
            if (this._watched.has(source))
                return;
            const ids = [];
            for (const name of ['notify::count', 'notification-added', 'notification-removed']) {
                try {
                    ids.push(source.connect(name, () => this._updateBadges()));
                } catch {
                    // That signal does not exist on this kind of source.
                }
            }
            ids.push(source.connect('destroy', () => {
                this._watched.delete(source);
                this._updateBadges();
            }));
            this._watched.set(source, ids);
        };
        this._watched = new Map();
        this._connect(tray, 'source-added', (_t, source) => {
            watch(source);
            this._updateBadges();
        });
        this._connect(tray, 'source-removed', () => this._updateBadges());
        for (const source of tray.getSources?.() ?? [])
            watch(source);
        this._updateBadges();
    }

    _unwatchNotifications() {
        for (const [source, ids] of this._watched ?? []) {
            for (const id of ids) {
                try {
                    source.disconnect(id);
                } catch {}
            }
        }
        this._watched = null;
    }

    _updateBadges() {
        if (!this.actor || this._actorGone || !this._settings.get_boolean('dock-badges'))
            return;
        const counts = new Map();
        for (const source of Main.messageTray.getSources?.() ?? []) {
            const id = source.app?.get_id?.() ?? source.policy?.id;
            const count = source.count ?? source.unseenCount ?? 0;
            if (id && count > 0)
                counts.set(id, (counts.get(id) ?? 0) + count);
        }
        for (const item of this._items) {
            if (!item.app)
                continue;
            const id = item.app.get_id();
            item.setBadge(counts.get(id) ?? counts.get(id.replace(/\.desktop$/, '')) ?? 0);
        }
        this._relayout();
    }

    // ---- poof ------------------------------------------------------------

    // The puff of smoke when an icon is dragged off the dock (or the trash is
    // emptied): a few soft circles swell, drift apart and fade.
    poof(x, y) {
        const group = Main.layoutManager.uiGroup;
        const puffs = [];
        for (let i = 0; i < 7; i++) {
            const size = 26 + Math.random() * 22;
            const puff = new St.Widget({style_class: 'gnomac-dock-poof', reactive: false,
                width: size, height: size});
            puff.set_pivot_point(0.5, 0.5);
            puff.set_position(Math.round(x - size / 2), Math.round(y - size / 2));
            puff.set_scale(0.3, 0.3);
            puff.opacity = 230;
            group.add_child(puff);
            puffs.push(puff);
            this._poofs ??= new Set();
            this._poofs.add(puff);
            puff.connect('destroy', () => this._poofs?.delete(puff));
            const angle = (i / 7) * 2 * Math.PI + Math.random() * 0.6;
            const distance = 26 + Math.random() * 30;
            puff.ease({
                scale_x: 1.7 + Math.random() * 0.7,
                scale_y: 1.7 + Math.random() * 0.7,
                translation_x: Math.cos(angle) * distance,
                translation_y: Math.sin(angle) * distance - 10,
                opacity: 0,
                duration: 520 + Math.random() * 160,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onStopped: () => puff.destroy(),
            });
        }
        try {
            global.display.get_sound_player().play_from_theme('trash-empty', 'Poof', null);
        } catch {}
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

        // Collapse the transparent headroom once the dock is at rest, or it
        // would keep swallowing clicks meant for the windows above it.
        if (!this.actor.hover && this._hover.target === 0 && this._hover.settled) {
            this._hover.snap(0);
            this._expanded = false;
        }

        this._relayout();

        const active = bouncing || !this._hover.settled;
        if (!active) {
            this._ticking = false;
            this._publishIconGeometry();
        }
        return active;
    }

    // Tell mutter where each app sits in the dock: minimize animations
    // (our Genie, and GNOME's own) fly windows into that rectangle.
    _publishIconGeometry() {
        // During shell shutdown the actors die before disable() runs.
        if (!this.actor || this._actorGone)
            return;
        for (const item of this._items) {
            if (!item.app)
                continue;
            const [x, y] = item.icon.get_transformed_position();
            const [width, height] = item.icon.get_transformed_size();
            if (![x, y, width, height].every(Number.isFinite))
                continue;
            const rect = new Mtk.Rectangle({
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
            });
            for (const window of item.app.get_windows())
                window.set_icon_geometry(rect);
        }
    }

    get trashIconName() {
        return this._trash?.iconName ?? 'user-trash';
    }

    openLaunchpad() {
        const launchpad = this._extension.launchpad;
        if (launchpad)
            launchpad.toggle();
        else
            Main.overview.showApps();
    }

    openDownloads(item) {
        this._tooltip.opacity = 0;
        this._downloads.open(item.icon);
    }

    // ---- drag and drop -------------------------------------------------

    _favoriteCount() {
        return AppFavorites.getAppFavorites().getFavorites().length;
    }

    onDragBegin(item) {
        this._dragItem = item;
        this._tooltip.opacity = 0;
        this._relayout();
    }

    onDragEnd(item, accepted) {
        const wasFavorite = AppFavorites.getAppFavorites().isFavorite(item.app.get_id());
        const [, dockY] = this.actor.get_transformed_position();
        const glassTop = dockY + this.actor.height - this._glassHeight - FLOAT_MARGIN;
        const draggedAway = this._lastDragY !== undefined &&
            this._lastDragY < glassTop - this.base * 1.5;
        this._dragItem = null;
        this._dropIndex = -1;
        // Dragging a pinned app off the dock unpins it (macOS "Remove").
        if (!accepted && wasFavorite && draggedAway) {
            AppFavorites.getAppFavorites().removeFavorite(item.app.get_id());
            this.poof(this._lastDragX ?? 0, this._lastDragY ?? 0);
        }
        this._relayout();
    }

    _onDragMotion(event) {
        this._lastDragX = event.x;
        this._lastDragY = event.y;
        if (this._dropIndex >= 0 && !this.actor.contains(event.targetActor)) {
            this._dropIndex = -1;
            this._relayout();
        }
        return DND.DragMotionResult.CONTINUE;
    }

    _indexAt(x) {
        // Only the pinned section accepts drops.
        const limit = this._favoriteCount();
        let index = 0;
        for (const item of this._items.slice(0, limit)) {
            if (item !== this._dragItem && x < item.x + item.width / 2)
                break;
            index++;
        }
        return Math.min(index, limit);
    }

    handleDragOver(source, _actor, x, _y, _time) {
        if (!source?.app)
            return DND.DragMotionResult.NO_DROP;
        const index = this._indexAt(x);
        if (index !== this._dropIndex) {
            this._dropIndex = index;
            this._relayout();
        }
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        if (!source?.app)
            return false;
        const favorites = AppFavorites.getAppFavorites();
        const id = source.app.get_id();
        let position = this._indexAt(x);
        const current = favorites.getFavorites().findIndex(app => app.get_id() === id);
        if (current >= 0) {
            if (current < position)
                position--;
            favorites.moveFavoriteToPos(id, position);
        } else {
            favorites.addFavoriteAtPos(id, position);
        }
        this._dropIndex = -1;
        return true;
    }

    // ---- menus ---------------------------------------------------------

    _specialMenu(item) {
        const menu = new PopupMenu.PopupMenu(item, 0.5, St.Side.BOTTOM);
        const add = (label, callback) => {
            const entry = new PopupMenu.PopupMenuItem(label);
            entry.connect('activate', callback);
            menu.addMenuItem(entry);
        };
        if (item.kind === 'trash') {
            add(t('Open', 'Ouvrir'), () => openTrash());
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            add(t('Empty Trash…', 'Vider la Corbeille…'), () => confirmEmptyTrash());
        } else if (item.kind === 'downloads') {
            add(t('Open Downloads', 'Ouvrir Téléchargements'), () => {
                const uri = Gio.File.new_for_path(downloadsDir()).get_uri();
                Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
            });
        } else {
            return null;
        }
        return menu;
    }

    openMenu(item) {
        if (!item.app) {
            if (!item.menu) {
                item.menu = this._specialMenu(item);
                if (!item.menu)
                    return;
                Main.uiGroup.add_child(item.menu.actor);
                this._menuManager.addMenu(item.menu);
            }
            this._tooltip.opacity = 0;
            item.menu.open(BoxPointer.PopupAnimation.FULL);
            return;
        }
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
