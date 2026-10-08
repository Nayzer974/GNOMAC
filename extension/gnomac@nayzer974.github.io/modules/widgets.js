// Desktop widgets (macOS 27): glass tiles on the wallpaper, under every
// window, that the user can add, remove, move, resize, colour and restyle.
//
// The layout is one JSON setting (`widgets-layout`): a list of
// {id, type, size, col, row, material, color, options}. lib/widgetTypes.js
// and lib/widgetExtras.js hold what each type shows; this module owns the
// glass, the grid, edit mode and persistence. Tiles live in the background
// group, so windows cover them and the overview treats them as part of the
// wallpaper.
//
// Edit mode ("Edit Widgets…" in the desktop context menu, or from Spotlight):
// tiles wiggle over a dotted grid, a − badge removes one, dragging moves it
// (a ghost shows where it will land, and a tile dropped on a taken spot goes
// to the nearest free one), a handle resizes it, a context menu changes its
// colour, material and size, and a gallery panel adds new ones or tidies the
// whole desktop.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {getTicker} from '../lib/spring.js';
import {ACCENTS, CELL, CELL_GAP, MATERIALS, SIZE_SPANS, SIZE_TITLES, WIDGET_TYPES, defaultLayout}
    from '../lib/widgetTypes.js';
import {press} from '../lib/motion.js';
import {uiScale} from '../lib/ui.js';
import {desktopLayer} from '../lib/desktopLayer.js';
import {t} from '../lib/i18n.js';

const RADIUS = 22;
// One column of the grid (a unit and its share of the gap).
const UNIT = CELL + CELL_GAP / 2;
const MARGIN = 18;
const BOTTOM_RESERVE = 110; // the dock

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
        this.accent = (ACCENTS[instance.color ?? 'auto'] ?? ACCENTS.auto).rgb;

        this.actor = new St.Widget({width: this.width, height: this.height, reactive: true,
            name: `gnomac-widget-${instance.id}`});
        this.actor.set_pivot_point(0.5, 0.5);

        const material = MATERIALS[instance.material] ?? MATERIALS.clear;
        const base = glassParamsFromSettings(settings, RADIUS);
        // Tinted and Colour take the widget's accent (blue when it has none).
        const rgb = material.accent ? (this.accent ?? [0.19, 0.36, 0.86])
            : (material.base ?? base.tint.slice(0, 3));
        this.glass = new GlassSurface({
            backdrop: 'wallpaper',
            blur: material.blur,
            glass: {...base, tint: [...rgb, material.tintAlpha], refraction: 8, chroma: 0.7, rim: 0.4, depthShade: 0.16},
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
                // On a coloured tile everything stays white: the colour is the tile.
                accent: material.accent ? null : this.accent,
                instance: {
                    options: instance.options,
                    save: () => manager.save(),
                },
            });
            if (this.built.flush)
                this.content.add_style_class_name('flush');
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
                if (!this._dragging)
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
            this._dragging = true;
            this.actor.ease({rotation_angle_z: 0, duration: 80});
            this.actor.get_parent()?.set_child_above_sibling(this.actor, null);
            this.actor.ease({scale_x: this.manager.scale * 1.04, scale_y: this.manager.scale * 1.04, duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('motion-event', (_a, event) => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            drag.moved = true;
            this.place(drag.ox + (x - drag.x), drag.oy + (y - drag.y));
            this.manager.previewDrop(this);
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-release-event', () => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            this._dragging = false;
            this.actor.ease({scale_x: this.manager.scale, scale_y: this.manager.scale, duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_BACK});
            if (drag.moved)
                this.manager.dropTile(this);
            this.manager.hidePreview();
            drag = null;
            return Clutter.EVENT_STOP;
        });

        // Resize handle: cycles through the sizes the type allows.
        this.handle.connect('button-press-event', () => {
            this.manager.cycleSize(this.instance.id);
            return Clutter.EVENT_STOP;
        });

        // Right click: colour, material and size menu.
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
        this._introduce();
    }

    // The tiles settle in one after another when the desktop appears.
    _introduce() {
        this._tiles.forEach((tile, i) => {
            tile.actor.opacity = 0;
            tile.actor.translation_y = 18;
            tile.actor.ease({opacity: 255, translation_y: 0, duration: 520, delay: 120 + i * 70,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        });
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
        desktopLayer.release('widgets-tiles');
        desktopLayer.release('widgets-grid');
    }

    // -------------------------------------------------------------- layout

    _loadLayout() {
        // '' means "never edited": start from the defaults. An empty list is a
        // choice (the user removed everything) and must survive a reboot.
        const raw = this.settings.get_string('widgets-layout');
        if (raw !== '') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.filter(w => WIDGET_TYPES[w?.type] && SIZE_SPANS[w.size])
                        .map(w => ({color: 'auto', options: {}, material: 'clear', ...w}));
                }
            } catch {}
        }
        return defaultLayout();
    }

    save() {
        this.settings.set_string('widgets-layout', JSON.stringify(this._layout));
    }

    _build() {
        const group = desktopLayer.acquire('widgets-tiles').actor;
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
        for (const tile of this._tiles)
            tile.built?.update?.();
    }

    // The user's size for the whole desktop of widgets, on top of the UI scale.
    get scale() {
        return uiScale() * this.settings.get_double('widgets-scale');
    }

    get _anchorRight() {
        return this.settings.get_string('widgets-anchor') === 'right';
    }

    _origin() {
        const monitor = Main.layoutManager.primaryMonitor;
        const gap = this.settings.get_int('window-gap');
        const margin = this.settings.get_int('widgets-margin');
        return {
            left: monitor.x + gap + margin,
            right: monitor.x + monitor.width - gap - margin,
            top: monitor.y + Main.panel.height + gap + margin,
            monitor,
        };
    }

    // The visual top-left of a tile from its grid cell, and back.
    _cellToPoint(col, row, width) {
        const {left, right, top} = this._origin();
        const k = this.scale;
        const x = this._anchorRight ? right - col * UNIT * k - width * k : left + col * UNIT * k;
        return [x, top + row * UNIT * k];
    }

    _pointToCell(x, y, width) {
        const {left, right, top} = this._origin();
        const k = this.scale;
        const col = this._anchorRight ? (right - x - width * k) / (UNIT * k) : (x - left) / (UNIT * k);
        return [col, (y - top) / (UNIT * k)];
    }

    _placeAll() {
        if (!Main.layoutManager.primaryMonitor)
            return;
        const k = this.scale;
        for (const tile of this._tiles) {
            const {col, row} = tile.instance;
            const [x, y] = this._cellToPoint(col, row, tile.width);
            tile.actor.set_pivot_point(0.5, 0.5);
            tile.actor.set_scale(k, k);
            // The pivot is the centre, so the visual corner sits (1 - k) / 2 inside.
            tile.place(x - (tile.width * (1 - k)) / 2, y - (tile.height * (1 - k)) / 2);
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

    _bounds() {
        const monitor = Main.layoutManager.primaryMonitor;
        const k = this.scale;
        const margin = this.settings.get_int('widgets-margin');
        return {
            cols: Math.floor((monitor.width / k - 2 * margin) / UNIT),
            rows: Math.floor((monitor.height / k - 2 * margin - BOTTOM_RESERVE) / UNIT),
        };
    }

    _fits(instance, col, row, taken = this._occupied(instance.id)) {
        const [cols, rows] = SIZE_SPANS[instance.size];
        const bounds = this._bounds();
        if (col < 0 || row < 0 || col + cols > bounds.cols || row + rows > bounds.rows)
            return false;
        for (let c = 0; c < cols; c++)
            for (let r = 0; r < rows; r++)
                if (taken.has(`${col + c},${row + r}`))
                    return false;
        return true;
    }

    // First free spot, scanning like reading order.
    _findSpot(instance) {
        const taken = this._occupied(instance.id);
        const bounds = this._bounds();
        for (let row = 0; row < bounds.rows; row += 2)
            for (let col = 0; col < bounds.cols; col += 2)
                if (this._fits(instance, col, row, taken))
                    return [col, row];
        return null;
    }

    // The free spot closest to where the tile was let go.
    _nearestSpot(instance, wantedCol, wantedRow) {
        const taken = this._occupied(instance.id);
        const bounds = this._bounds();
        let best = null;
        let bestDistance = Infinity;
        for (let row = 0; row < bounds.rows; row += 2) {
            for (let col = 0; col < bounds.cols; col += 2) {
                if (!this._fits(instance, col, row, taken))
                    continue;
                const d = (col - wantedCol) ** 2 + (row - wantedRow) ** 2;
                if (d < bestDistance) {
                    bestDistance = d;
                    best = [col, row];
                }
            }
        }
        return best;
    }

    _dropTarget(tile) {
        const k = this.scale;
        const x = tile.actor.x + (tile.width * (1 - k)) / 2;
        const y = tile.actor.y + (tile.height * (1 - k)) / 2;
        const [col, row] = this._pointToCell(x, y, tile.width);
        return this._nearestSpot(tile.instance, Math.round(col / 2) * 2, Math.round(row / 2) * 2);
    }

    // A ghost outline where the tile will land.
    previewDrop(tile) {
        const target = this._dropTarget(tile);
        if (!target) {
            this.hidePreview();
            return;
        }
        if (!this._ghost) {
            this._ghost = new St.Widget({style_class: 'gnomac-widget-ghost', reactive: false});
            tile.actor.get_parent().insert_child_below(this._ghost, tile.actor);
        }
        const k = this.scale;
        const [x, y] = this._cellToPoint(target[0], target[1], tile.width);
        this._ghost.set_size(Math.round(tile.width * k), Math.round(tile.height * k));
        this._ghost.set_position(Math.round(x), Math.round(y));
        this._ghost.show();
    }

    hidePreview() {
        this._ghost?.destroy();
        this._ghost = null;
    }

    dropTile(tile) {
        const target = this._dropTarget(tile);
        if (target) {
            [tile.instance.col, tile.instance.row] = target;
            this.save();
        }
        this._placeAll();
    }

    setSize(id, size) {
        const instance = this._layout.find(w => w.id === id);
        if (!instance || instance.size === size)
            return;
        const previous = instance.size;
        instance.size = size;
        if (!this._fits(instance, instance.col, instance.row)) {
            const spot = this._nearestSpot(instance, instance.col, instance.row);
            if (spot) {
                [instance.col, instance.row] = spot;
            } else {
                instance.size = previous;
                Main.notify('GNOMAC', t('No room for that size.', 'Pas de place pour cette taille.'));
                return;
            }
        }
        this.save();
        this._rebuild();
    }

    cycleSize(id) {
        const instance = this._layout.find(w => w.id === id);
        const sizes = WIDGET_TYPES[instance.type].sizes;
        // Try the next sizes in turn until one fits.
        for (let i = 1; i <= sizes.length; i++) {
            const next = sizes[(sizes.indexOf(instance.size) + i) % sizes.length];
            const probe = {...instance, size: next};
            if (next === instance.size || this._nearestSpot(probe, instance.col, instance.row)) {
                this.setSize(id, next);
                return;
            }
        }
    }

    setMaterial(id, material) {
        const instance = this._layout.find(w => w.id === id);
        instance.material = material;
        this.save();
        this._rebuild();
    }

    setColor(id, color) {
        const instance = this._layout.find(w => w.id === id);
        instance.color = color;
        // "Tinted" without a colour is the old default blue; with one, the
        // colour shows, so picking a colour on a clear tile tints it.
        if (color !== 'auto' && instance.material === 'clear')
            instance.material = 'tinted';
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
            color: 'auto',
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

    // Pack every tile again, biggest first, in reading order.
    autoArrange() {
        const order = [...this._layout].sort((a, b) => {
            const [ac, ar] = SIZE_SPANS[a.size];
            const [bc, br] = SIZE_SPANS[b.size];
            return bc * br - ac * ar || a.row - b.row || a.col - b.col;
        });
        for (const w of this._layout)
            w.col = w.row = -1000;
        for (const w of order) {
            const spot = this._findSpot(w);
            if (spot)
                [w.col, w.row] = spot;
        }
        // Whatever found no room is put back on the first free cell, or last.
        for (const w of this._layout) {
            if (w.col < 0)
                [w.col, w.row] = this._findSpot(w) ?? [0, 0];
        }
        this.save();
        this._placeAll();
    }

    resetLayout() {
        this._layout = defaultLayout();
        this.save();
        this._rebuild();
    }

    // -------------------------------------------------------------- menus

    openTileMenu(tile) {
        this._menu?.destroy();
        const menu = new PopupMenu.PopupMenu(tile.actor, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        const instance = tile.instance;

        const colors = new PopupMenu.PopupSubMenuMenuItem(t('Colour', 'Couleur'));
        for (const [id, accent] of Object.entries(ACCENTS)) {
            const item = new PopupMenu.PopupMenuItem(accent.title);
            if ((instance.color ?? 'auto') === id)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this.setColor(instance.id, id));
            colors.menu.addMenuItem(item);
        }
        menu.addMenuItem(colors);

        const materials = new PopupMenu.PopupSubMenuMenuItem(t('Material', 'Matière'));
        for (const [id, material] of Object.entries(MATERIALS)) {
            const item = new PopupMenu.PopupMenuItem(material.title);
            if (instance.material === id)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this.setMaterial(instance.id, id));
            materials.menu.addMenuItem(item);
        }
        menu.addMenuItem(materials);

        const def = WIDGET_TYPES[instance.type];
        if (def.sizes.length > 1) {
            const sizes = new PopupMenu.PopupSubMenuMenuItem(t('Size', 'Taille'));
            for (const size of def.sizes) {
                const item = new PopupMenu.PopupMenuItem(SIZE_TITLES[size] ?? size);
                if (instance.size === size)
                    item.setOrnament(PopupMenu.Ornament.DOT);
                item.connect('activate', () => this.setSize(instance.id, size));
                sizes.menu.addMenuItem(item);
            }
            menu.addMenuItem(sizes);
        }
        for (const prompt of def.prompts ?? []) {
            const item = new PopupMenu.PopupMenuItem(`${prompt.label}…`);
            item.connect('activate', () => this._askOption(tile, prompt));
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const edit = new PopupMenu.PopupMenuItem(t('Edit Widgets…', 'Modifier les widgets…'));
        edit.connect('activate', () => this.startEditing());
        menu.addMenuItem(edit);
        const remove = new PopupMenu.PopupMenuItem(t('Remove Widget', 'Retirer le widget'));
        remove.connect('activate', () => this.remove(instance.id));
        menu.addMenuItem(remove);
        menu.open(true);
        this._menu = menu;
    }

    // A small prompt over the tile: the typed text is parsed by the widget
    // type (a city, time zones, an event, a photo path…).
    _askOption(tile, prompt) {
        const entry = new St.Entry({style_class: 'gnomac-widget-entry', hint_text: prompt.hint ?? prompt.label,
            width: tile.width - 24});
        entry.set_position(12, tile.height - 40);
        entry.text = prompt.format?.(tile.instance.options[prompt.key]) ?? '';
        tile.actor.add_child(entry);
        entry.grab_key_focus();
        entry.clutter_text.connect('activate', () => {
            const value = prompt.parse(entry.text);
            if (value === null || value === undefined || (Array.isArray(value) && !value.length && entry.text.trim())) {
                Main.notify('GNOMAC', t('That value is not valid.', 'Cette valeur n’est pas valide.'));
                return;
            }
            if (value === '' || (Array.isArray(value) && !value.length))
                delete tile.instance.options[prompt.key];
            else
                tile.instance.options[prompt.key] = value;
            this.save();
            this._rebuild();
        });
        entry.clutter_text.connect('key-focus-out', () => entry.destroy());
    }

    _addDesktopMenuItem() {
        // The desktop layer builds the desktop menu from its providers.
        this._menuProvider = (_menu, add) => add(t('Edit Widgets…', 'Modifier les widgets…'), () => this.startEditing());
        desktopLayer.acquire(this).menuProviders.add(this._menuProvider);
    }

    _removeDesktopMenuItem() {
        if (this._menuProvider) {
            desktopLayer.menuProviders.delete(this._menuProvider);
            desktopLayer.release(this);
            this._menuProvider = null;
        }
    }

    // -------------------------------------------------------------- editing

    startEditing() {
        if (this.editing)
            return;
        this.editing = true;
        this._showGrid();
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
        this.hidePreview();
        this._hideGrid(animate);
        this._closeGallery(animate);
    }

    // Faint dots on every cell corner while editing, so the grid is visible.
    _showGrid() {
        const {left, right, top, monitor} = this._origin();
        const k = this.scale;
        const bounds = this._bounds();
        const grid = new St.DrawingArea({reactive: false, x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height, opacity: 0});
        grid.connect('repaint', area => {
            const cr = area.get_context();
            cr.setSourceRGBA(1, 1, 1, 0.34);
            for (let c = 0; c <= bounds.cols; c += 2) {
                for (let r = 0; r <= bounds.rows; r += 2) {
                    const x = (this._anchorRight ? right - c * UNIT * k : left + c * UNIT * k) - monitor.x;
                    const y = top + r * UNIT * k - monitor.y;
                    cr.arc(x, y, 1.6, 0, 2 * Math.PI);
                    cr.fill();
                }
            }
            cr.$dispose();
        });
        if (this._tiles.length)
            this._tiles[0].actor.get_parent().insert_child_below(grid, this._tiles[0].actor);
        else
            desktopLayer.acquire('widgets-grid').actor.add_child(grid);
        grid.ease({opacity: 255, duration: 260});
        this._grid = grid;
    }

    _hideGrid(animate) {
        const grid = this._grid;
        this._grid = null;
        if (!grid)
            return;
        if (animate)
            grid.ease({opacity: 0, duration: 200, onStopped: () => grid.destroy()});
        else
            grid.destroy();
    }

    _openGallery() {
        const monitor = Main.layoutManager.primaryMonitor;
        const width = 280;
        const height = Math.min(monitor.height - 140, 150 + Object.keys(WIDGET_TYPES).length * 52);
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

        // Tidy up / start over.
        const tools = new St.BoxLayout({style_class: 'gnomac-gallery-tools'});
        const tidy = press(new St.Button({style_class: 'gnomac-notch-pill-button', x_expand: true,
            label: t('Tidy Up', 'Ranger'), can_focus: false}));
        tidy.connect('clicked', () => this.autoArrange());
        const reset = press(new St.Button({style_class: 'gnomac-notch-pill-button', x_expand: true,
            label: t('Reset', 'Réinitialiser'), can_focus: false}));
        reset.connect('clicked', () => this.resetLayout());
        tools.add_child(tidy);
        tools.add_child(reset);
        box.add_child(tools);

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
