// Desktop widgets (macOS 27): glass tiles on the wallpaper, under every
// window, that the user can add, remove, move, resize and restyle.
//
// The layout is one JSON setting (`widgets-layout`): a list of
// {id, type, size, col, row, material, options}. lib/widgetTypes.js holds
// what each type shows; this module owns the glass, the grid, edit mode and
// persistence. Tiles live in the background group, so windows cover them and
// the overview treats them as part of the wallpaper.
//
// Edit mode ("Edit Widgets…" in the desktop context menu, or from Spotlight):
// tiles wiggle, a − badge removes one, dragging moves it on the grid, a
// handle resizes it, a context menu changes its material, and a gallery
// panel adds new ones.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {getTicker} from '../lib/spring.js';
import {CELL, CELL_GAP, MATERIALS, SIZE_SPANS, WIDGET_TYPES, defaultLayout} from '../lib/widgetTypes.js';
import {press} from '../lib/motion.js';
import {uiScale} from '../lib/ui.js';
import {t} from '../lib/i18n.js';

const RADIUS = 22;
// One column of the grid (a unit and its share of the gap).
const UNIT = CELL + CELL_GAP / 2;
const MARGIN = 18;

class WidgetTile {
    constructor(manager, instance) {
        this.manager = manager;
        this.instance = instance;
        const settings = manager.settings;
        const type = WIDGET_TYPES[instance.type];
        const [cols, rows] = SIZE_SPANS[instance.size];
        // A tile spans `cols` x `rows` units of CELL px, gaps included.
        this.width = cols * CELL + (cols / 2 - 1) * CELL_GAP;
        this.height = rows * CELL + (rows / 2 - 1) * CELL_GAP;

        this.actor = new St.Widget({width: this.width, height: this.height, reactive: true,
            name: `gnomac-widget-${instance.id}`});
        this.actor.set_pivot_point(0.5, 0.5);

        const material = MATERIALS[instance.material] ?? MATERIALS.clear;
        const base = glassParamsFromSettings(settings, RADIUS);
        const tint = material.accent ? [0.19, 0.36, 0.86, material.tintAlpha]
            : [...base.tint.slice(0, 3), material.tintAlpha];
        this.glass = new GlassSurface({
            backdrop: 'wallpaper',
            blur: material.blur,
            glass: {...base, tint, refraction: 8, chroma: 0.7, rim: 0.4, depthShade: 0.16},
        });
        this.glass.set_size(this.width, this.height);
        this.actor.add_child(this.glass);
        this.glass.followPointer(this.actor, 1);

        this.content = new St.BoxLayout({style_class: 'gnomac-widget', width: this.width, height: this.height});
        this.actor.add_child(this.content);

        this.built = null;
        try {
            this.built = type.build({
                settings,
                size: instance.size,
                options: instance.options,
                instance: {
                    options: instance.options,
                    save: () => manager.save(),
                },
            });
            this.content.add_child(this.built.actor);
        } catch (e) {
            logError(e, `GNOMAC widget ${instance.type}`);
        }

        // Edit chrome (hidden until edit mode).
        this.badge = press(new St.Button({style_class: 'gnomac-widget-badge', label: '−', visible: false,
            can_focus: false, x: -8, y: -8}));
        this.badge.connect('clicked', () => manager.remove(instance.id));
        this.handle = new St.Widget({style_class: 'gnomac-widget-handle', visible: false, reactive: true,
            width: 22, height: 22, x: this.width - 22, y: this.height - 22});
        this.actor.add_child(this.badge);
        this.actor.add_child(this.handle);
        this._wireEditing();
        this._wiggle = null;
    }

    place(x, y) {
        this.actor.set_position(Math.round(x), Math.round(y));
        this.glass.setStageOrigin(x, y);
    }

    setEditing(editing) {
        this.badge.visible = editing;
        this.handle.visible = editing;
        if (editing && !this._wiggle) {
            this._phase = Math.random() * Math.PI * 2;
            this._wiggle = dt => {
                if (this.actor.is_finalized?.())
                    return false;
                this._phase += dt * 14;
                this.actor.rotation_angle_z = Math.sin(this._phase) * 0.9;
                return true;
            };
            getTicker().add(this._wiggle);
        } else if (!editing && this._wiggle) {
            getTicker().remove(this._wiggle);
            this._wiggle = null;
            this.actor.ease({rotation_angle_z: 0, duration: 160});
        }
    }

    _wireEditing() {
        // Drag to move (edit mode).
        let drag = null;
        this.actor.connect('button-press-event', (_a, event) => {
            if (!this.manager.editing || event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            drag = {x, y, ox: this.actor.x, oy: this.actor.y, moved: false};
            Main.layoutManager._backgroundGroup.set_child_above_sibling(this.actor, null);
            this.actor.ease({scale_x: 1.04, scale_y: 1.04, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('motion-event', (_a, event) => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            drag.moved = true;
            this.place(drag.ox + (x - drag.x), drag.oy + (y - drag.y));
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-release-event', () => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            this.actor.ease({scale_x: 1, scale_y: 1, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_BACK});
            if (drag.moved)
                this.manager.dropTile(this, this.actor.x, this.actor.y);
            drag = null;
            return Clutter.EVENT_STOP;
        });

        // Resize handle: cycles through the sizes the type allows.
        this.handle.connect('button-press-event', () => {
            this.manager.cycleSize(this.instance.id);
            return Clutter.EVENT_STOP;
        });

        // Right click: material and size menu.
        this.actor.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this.manager.openTileMenu(this);
            return Clutter.EVENT_STOP;
        });
    }

    destroy() {
        if (this._wiggle)
            getTicker().remove(this._wiggle);
        this.built?.destroy?.();
        this.actor.destroy();
    }
}

export class Widgets {
    constructor(extension) {
        this._extension = extension;
        this.settings = extension.getSettings();
        this._tiles = [];
        this._layout = [];
        this.editing = false;
    }

    enable() {
        this._extension.widgets = this;
        this._layout = this._loadLayout();
        this._build();
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._placeAll());
        this._overviewIds = [
            Main.overview.connect('showing', () => this._tiles.forEach(tile => tile.actor.hide())),
            Main.overview.connect('hidden', () => this._tiles.forEach(tile => tile.actor.show())),
        ];
        // Types that show live data tick on their own schedule.
        this._seconds = 0;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._seconds++;
            for (const tile of this._tiles) {
                const tick = tile.built?.tick;
                if (tick && this._seconds % tick === 0)
                    tile.built.update?.();
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._addDesktopMenuItem();
        // First reading of the live widgets, now that they are on stage.
        for (const tile of this._tiles)
            tile.built?.update?.();
    }

    disable() {
        this.stopEditing(false);
        this._removeDesktopMenuItem();
        if (this._extension.widgets === this)
            this._extension.widgets = null;
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        for (const id of this._overviewIds ?? [])
            Main.overview.disconnect(id);
        this._overviewIds = [];
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._menu?.destroy();
        this._menu = null;
        for (const tile of this._tiles)
            tile.destroy();
        this._tiles = [];
    }

    // -------------------------------------------------------------- layout

    _loadLayout() {
        try {
            const parsed = JSON.parse(this.settings.get_string('widgets-layout'));
            if (Array.isArray(parsed) && parsed.length)
                return parsed.filter(w => WIDGET_TYPES[w.type] && SIZE_SPANS[w.size]);
        } catch {}
        return defaultLayout();
    }

    save() {
        this.settings.set_string('widgets-layout', JSON.stringify(this._layout));
    }

    _build() {
        const group = Main.layoutManager._backgroundGroup;
        for (const instance of this._layout) {
            const tile = new WidgetTile(this, instance);
            group.add_child(tile.actor);
            this._tiles.push(tile);
        }
        this._placeAll();
    }

    _rebuild() {
        for (const tile of this._tiles)
            tile.destroy();
        this._tiles = [];
        this._build();
        for (const tile of this._tiles)
            tile.setEditing(this.editing);
    }

    get _scale() {
        return uiScale();
    }

    _origin() {
        const monitor = Main.layoutManager.primaryMonitor;
        const gap = this.settings.get_int('window-gap');
        return {
            x: monitor.x + gap + MARGIN,
            y: monitor.y + Main.panel.height + gap + MARGIN,
            monitor,
        };
    }

    _placeAll() {
        if (!Main.layoutManager.primaryMonitor)
            return;
        const {x, y} = this._origin();
        const k = this._scale;
        for (const tile of this._tiles) {
            const {col, row} = tile.instance;
            tile.actor.set_pivot_point(0.5, 0.5);
            tile.actor.set_scale(k, k);
            tile.place(x + col * UNIT * k - (tile.width * (1 - k)) / 2,
                y + row * UNIT * k - (tile.height * (1 - k)) / 2);
        }
    }

    // Tiles occupy half-pitch cells (2 columns = one square tile).
    _occupied(exceptId) {
        const taken = new Set();
        for (const w of this._layout) {
            if (w.id === exceptId)
                continue;
            const [cols, rows] = SIZE_SPANS[w.size];
            for (let c = 0; c < cols; c++)
                for (let r = 0; r < rows; r++)
                    taken.add(`${w.col + c},${w.row + r}`);
        }
        return taken;
    }

    _fits(instance, col, row) {
        const [cols, rows] = SIZE_SPANS[instance.size];
        const monitor = Main.layoutManager.primaryMonitor;
        const maxCol = Math.floor((monitor.width / this._scale - 2 * MARGIN) / UNIT);
        const maxRow = Math.floor((monitor.height / this._scale - 2 * MARGIN - 110) / UNIT);
        if (col < 0 || row < 0 || col + cols > maxCol || row + rows > maxRow)
            return false;
        const taken = this._occupied(instance.id);
        for (let c = 0; c < cols; c++)
            for (let r = 0; r < rows; r++)
                if (taken.has(`${col + c},${row + r}`))
                    return false;
        return true;
    }

    // First free spot, scanning like reading order.
    _findSpot(instance) {
        for (let row = 0; row < 40; row += 2)
            for (let col = 0; col < 40; col += 2)
                if (this._fits(instance, col, row))
                    return [col, row];
        return null;
    }

    dropTile(tile, x, y) {
        const {x: ox, y: oy} = this._origin();
        const k = this._scale;
        const col = Math.round((x - ox) / (UNIT * k) / 2) * 2;
        const row = Math.round((y - oy) / (UNIT * k) / 2) * 2;
        if (this._fits(tile.instance, col, row)) {
            tile.instance.col = col;
            tile.instance.row = row;
            this.save();
        }
        this._placeAll();
    }

    cycleSize(id) {
        const instance = this._layout.find(w => w.id === id);
        const sizes = WIDGET_TYPES[instance.type].sizes;
        const next = sizes[(sizes.indexOf(instance.size) + 1) % sizes.length];
        const previous = instance.size;
        instance.size = next;
        if (!this._fits(instance, instance.col, instance.row)) {
            const spot = this._findSpot(instance);
            if (spot)
                [instance.col, instance.row] = spot;
            else
                instance.size = previous;
        }
        this.save();
        this._rebuild();
    }

    setMaterial(id, material) {
        const instance = this._layout.find(w => w.id === id);
        instance.material = material;
        this.save();
        this._rebuild();
    }

    remove(id) {
        const tile = this._tiles.find(t_ => t_.instance.id === id);
        this._layout = this._layout.filter(w => w.id !== id);
        this.save();
        if (tile) {
            tile.actor.ease({opacity: 0, scale_x: 0.8, scale_y: 0.8, duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => this._rebuild()});
        }
    }

    add(type) {
        const def = WIDGET_TYPES[type];
        const instance = {
            id: `w-${type}-${Date.now().toString(36)}`,
            type,
            size: def.sizes[0],
            col: 0,
            row: 0,
            material: 'clear',
            options: {},
        };
        const spot = this._findSpot(instance);
        if (!spot) {
            Main.notify('GNOMAC', t('No room left on the desktop.', 'Plus de place sur le bureau.'));
            return;
        }
        [instance.col, instance.row] = spot;
        this._layout.push(instance);
        this.save();
        this._rebuild();
    }

    // -------------------------------------------------------------- menus

    openTileMenu(tile) {
        this._menu?.destroy();
        const menu = new PopupMenu.PopupMenu(tile.actor, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        for (const [id, material] of Object.entries(MATERIALS)) {
            const item = new PopupMenu.PopupMenuItem(material.title);
            if (tile.instance.material === id)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this.setMaterial(tile.instance.id, id));
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const sizes = WIDGET_TYPES[tile.instance.type].sizes;
        if (sizes.length > 1) {
            const next = new PopupMenu.PopupMenuItem(t('Change Size', 'Changer la taille'));
            next.connect('activate', () => this.cycleSize(tile.instance.id));
            menu.addMenuItem(next);
        }
        if (WIDGET_TYPES[tile.instance.type].options?.includes('city')) {
            const city = new PopupMenu.PopupMenuItem(t('Set City…', 'Choisir la ville…'));
            city.connect('activate', () => this._askCity(tile));
            menu.addMenuItem(city);
        }
        const edit = new PopupMenu.PopupMenuItem(t('Edit Widgets…', 'Modifier les widgets…'));
        edit.connect('activate', () => this.startEditing());
        menu.addMenuItem(edit);
        const remove = new PopupMenu.PopupMenuItem(t('Remove Widget', 'Retirer le widget'));
        remove.connect('activate', () => this.remove(tile.instance.id));
        menu.addMenuItem(remove);
        menu.open(true);
        this._menu = menu;
    }

    _askCity(tile) {
        // A tiny inline prompt: the weather widget's city comes from the
        // clipboard-free entry shown over the tile.
        const entry = new St.Entry({style_class: 'gnomac-widget-entry', hint_text: t('City', 'Ville'),
            width: tile.width - 24});
        entry.set_position(12, tile.height - 40);
        tile.actor.add_child(entry);
        entry.grab_key_focus();
        entry.clutter_text.connect('activate', () => {
            tile.instance.options.city = entry.text.trim();
            this.save();
            this._rebuild();
        });
        entry.clutter_text.connect('key-focus-out', () => entry.destroy());
    }

    _addDesktopMenuItem() {
        // GNOME exposes the desktop menu on the background actors.
        this._menuItems = [];
        const monitors = Main.layoutManager._bgManagers ?? [];
        for (const manager of monitors) {
            const menu = manager.backgroundActor?._backgroundMenu;
            if (!menu)
                continue;
            const item = new PopupMenu.PopupMenuItem(t('Edit Widgets…', 'Modifier les widgets…'));
            item.connect('activate', () => this.startEditing());
            menu.addMenuItem(item, 0);
            this._menuItems.push(item);
        }
    }

    _removeDesktopMenuItem() {
        for (const item of this._menuItems ?? [])
            item.destroy();
        this._menuItems = [];
    }

    // -------------------------------------------------------------- editing

    startEditing() {
        if (this.editing)
            return;
        this.editing = true;
        for (const tile of this._tiles)
            tile.setEditing(true);
        this._openGallery();
        // Escape leaves edit mode; clicks on the empty desktop do not.
        this._keyId = global.stage.connect('key-press-event', (_s, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.stopEditing();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    stopEditing(animate = true) {
        if (!this.editing)
            return;
        this.editing = false;
        if (this._keyId) {
            global.stage.disconnect(this._keyId);
            this._keyId = 0;
        }
        for (const tile of this._tiles)
            tile.setEditing(false);
        this._closeGallery(animate);
    }

    _openGallery() {
        const monitor = Main.layoutManager.primaryMonitor;
        const width = 260;
        const height = Math.min(monitor.height - 140, 120 + Object.keys(WIDGET_TYPES).length * 58);
        const panel = new St.Widget({width, height, reactive: true});
        const glass = new GlassSurface({backdrop: 'windows', blur: 60,
            glass: {...glassParamsFromSettings(this.settings, 24), tint: [0.07, 0.07, 0.09, 0.4], depthShade: 0.12}});
        glass.set_size(width, height);
        panel.add_child(glass);
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-gallery',
            width, height});
        const header = new St.BoxLayout({style_class: 'gnomac-gallery-header'});
        header.add_child(new St.Label({text: t('Widgets', 'Widgets'), style_class: 'gnomac-gallery-title',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const done = press(new St.Button({style_class: 'gnomac-notch-pill-button primary',
            label: t('Done', 'Terminé'), can_focus: false}));
        done.connect('clicked', () => this.stopEditing());
        header.add_child(done);
        box.add_child(header);
        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-gallery-list'});
        for (const [type, def] of Object.entries(WIDGET_TYPES)) {
            const row = press(new St.Button({style_class: 'gnomac-gallery-row', can_focus: false,
                x_expand: true, x_align: Clutter.ActorAlign.FILL}));
            const inner = new St.BoxLayout({style_class: 'gnomac-gallery-item'});
            inner.add_child(new St.Icon({icon_name: def.icon, icon_size: 20, y_align: Clutter.ActorAlign.CENTER}));
            inner.add_child(new St.Label({text: def.title, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            inner.add_child(new St.Label({text: '+', style_class: 'gnomac-gallery-plus',
                y_align: Clutter.ActorAlign.CENTER}));
            row.set_child(inner);
            row.connect('clicked', () => this.add(type));
            list.add_child(row);
        }
        scroll.add_child(list);
        box.add_child(scroll);
        panel.add_child(box);

        const x = monitor.x + monitor.width - width - 22;
        const y = monitor.y + Main.panel.height + 18;
        panel.set_position(x, y);
        glass.setStageOrigin(x, y);
        Main.layoutManager.uiGroup.add_child(panel);
        panel.opacity = 0;
        panel.translation_x = 30;
        panel.ease({opacity: 255, translation_x: 0, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._gallery = panel;
    }

    _closeGallery(animate) {
        const panel = this._gallery;
        this._gallery = null;
        if (!panel)
            return;
        if (!animate) {
            panel.destroy();
            return;
        }
        panel.ease({opacity: 0, translation_x: 30, duration: 220, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => panel.destroy()});
    }
}
