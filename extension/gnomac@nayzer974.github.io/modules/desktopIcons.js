// Icons on the desktop: the files and folders of your Desktop folder, shown on
// the wallpaper and usable like on Windows / macOS:
//   - click selects (Ctrl+click adds, drag on an empty spot draws a selection
//     rectangle), double-click opens,
//   - drag an icon (or several) to move it; it snaps to a grid and is
//     remembered; drop it on the notch to keep it on the shelf,
//   - keys: Enter open, F2 rename, Delete trash, Ctrl+A / C / X / V,
//   - right-click an icon: Open, Rename, Copy, Cut, Copy Path, Keep on the
//     Shelf, Move to Trash,
//   - right-click the desktop: New Folder, New Text Document, Paste, Sort by,
//     Refresh, Select All, Show Desktop Items, Open in Terminal, Change
//     Background, Display Settings,
//   - the folder is watched: files added, renamed or deleted elsewhere appear
//     at once.
//
// WHERE IT LIVES. On the shared desktop layer (lib/desktopLayer.js): above the
// wallpaper, below every window, and above a wallpaper that is itself a window
// (Hidamari), so the icons stay visible and clickable over a video wallpaper.
// The layer takes the desktop's clicks, so the menu is ours.
//
// POINTER. A click is a press and a release that stay within a few pixels
// (trackpad taps wobble: the threshold is generous). Drags hold a pointer
// grab, so the icon keeps following when the pointer leaves it; releasing
// anywhere drops it.
//
// Honest limit: GNOME Shell on Wayland cannot receive a drag that starts in
// another application (such as the Files window), so dropping from Files onto
// the desktop is not possible; copy in Files and use "Paste" here instead.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {desktopLayer} from '../lib/desktopLayer.js';
import {uiScale} from '../lib/ui.js';
import {t} from '../lib/i18n.js';

const CELL_W = 96;
const CELL_H = 108;
const ICON = 58;
const MARGIN = 14;
const MAX_ITEMS = 240;
const ATTRS = 'standard::name,standard::display-name,standard::icon,standard::is-hidden,thumbnail::path,standard::type,standard::content-type,standard::size,time::modified';
const SIZES = {small: 0.85, medium: 1, large: 1.25};
const DRAG_THRESHOLD = 8;
const DOUBLE_CLICK_MS = 500;

function desktopPath() {
    const dir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
    // When there is no Desktop folder the setting points at $HOME: show nothing.
    return dir && dir !== GLib.get_home_dir() ? dir : null;
}

class IconTile {
    constructor(manager, info, file) {
        this.manager = manager;
        this.file = file;
        this.info = info;
        this.name = info.get_name();
        this.selected = false;
        const scale = manager.scale;

        this.actor = new St.BoxLayout({style_class: 'gnomac-desk-icon', orientation: Clutter.Orientation.VERTICAL, reactive: true,
            track_hover: true, width: Math.round(CELL_W * scale), height: Math.round(CELL_H * scale)});
        this.actor.set_pivot_point(0.5, 0.5);

        let gicon = info.get_icon();
        const thumb = info.get_attribute_byte_string('thumbnail::path');
        if (thumb)
            gicon = new Gio.FileIcon({file: Gio.File.new_for_path(thumb)});
        // Passing both gicon and icon_name makes icon_name win: only a fallback.
        this.icon = new St.Icon({icon_size: Math.round(ICON * scale),
            x_align: Clutter.ActorAlign.CENTER, style_class: 'gnomac-desk-icon-image'});
        if (gicon)
            this.icon.gicon = gicon;
        else
            this.icon.icon_name = info.get_file_type() === Gio.FileType.DIRECTORY ? 'folder' : 'text-x-generic';
        this.label = new St.Label({text: info.get_display_name(), style_class: 'gnomac-desk-icon-label',
            x_align: Clutter.ActorAlign.CENTER});
        this.label.clutter_text.set({line_wrap: true, line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.END, line_alignment: Pango.Alignment.CENTER});
        this.label.clutter_text.set_max_length(0);
        this.actor.add_child(this.icon);
        this.actor.add_child(this.label);
        this._wire();
    }

    uri() {
        return this.file.get_uri();
    }

    setSelected(selected) {
        this.selected = selected;
        if (selected)
            this.actor.add_style_pseudo_class('selected');
        else
            this.actor.remove_style_pseudo_class('selected');
    }

    _wire() {
        this.actor.connect('button-press-event', (_a, event) => this._onPress(event));
        this.actor.connect('motion-event', (_a, event) => this._onMotion(event));
        this.actor.connect('button-release-event', (_a, event) => this._onRelease(event));
        this.actor.connect('destroy', () => this._endGrab());
    }

    _endGrab() {
        try {
            this._grab?.dismiss();
        } catch {}
        this._grab = null;
        this._drag = null;
    }

    _onPress(event) {
        const button = event.get_button();
        const manager = this.manager;
        manager.focusLayer();
        if (button === Clutter.BUTTON_SECONDARY) {
            if (!this.selected)
                manager.select(this, false);
            // Opened when the button is released, so the release does not
            // land on the first entry.
            this._menuAt = event.get_coords();
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const [x, y] = event.get_coords();
        const now = GLib.get_monotonic_time() / 1000;
        const last = manager.lastClick;
        // Double click: GNOME's own count, or the same icon twice in a short
        // time (a trackpad's double tap is slower and wobblier than a mouse's).
        const double = (event.get_click_count?.() ?? 1) === 2 ||
            (last.tile === this && now - last.time < DOUBLE_CLICK_MS && Math.hypot(x - last.x, y - last.y) < 24);
        manager.lastClick = {tile: this, time: now, x, y};
        if (double && !ctrl) {
            manager.lastClick = {tile: null, time: 0, x: 0, y: 0};
            manager.open(this);
            return Clutter.EVENT_STOP;
        }
        // Pressing an icon that is already part of a selection keeps the
        // selection (so the group can be dragged); a plain click on release
        // narrows it to this icon.
        const keep = this.selected && !ctrl && manager.selected().length > 1;
        if (!keep)
            manager.select(this, ctrl);
        const moving = manager.selected();
        this._drag = {x, y, moved: false, wasSelected: keep, ctrl,
            starts: moving.map(tile => ({tile, x: tile.actor.x, y: tile.actor.y}))};
        try {
            this._grab = global.stage.grab(this.actor);
        } catch (e) {
            logError(e, 'GNOMAC desktop icons: pointer grab');
        }
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const threshold = DRAG_THRESHOLD * uiScale();
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < threshold)
            return Clutter.EVENT_STOP;
        if (!drag.moved) {
            drag.moved = true;
            for (const {tile} of drag.starts) {
                tile.actor.get_parent()?.set_child_above_sibling(tile.actor, null);
                tile.actor.ease({scale_x: 1.06, scale_y: 1.06, opacity: 220, duration: 120});
            }
        }
        for (const {tile, x: ox, y: oy} of drag.starts)
            tile.actor.set_position(Math.round(ox + x - drag.x), Math.round(oy + y - drag.y));
        this.manager.dragOver(this, x, y);
        return Clutter.EVENT_STOP;
    }

    _onRelease(event) {
        if (event.get_button() === Clutter.BUTTON_SECONDARY && this._menuAt) {
            const [mx, my] = this._menuAt;
            this._menuAt = null;
            this.manager.openMenu(this, mx, my);
            return Clutter.EVENT_STOP;
        }
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const starts = drag.starts;
        const moved = drag.moved;
        const narrow = drag.wasSelected && !moved;
        this._endGrab();
        if (moved) {
            for (const {tile} of starts)
                tile.actor.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 140});
            this.manager.drop(this, starts.map(s => s.tile), x, y);
        } else if (narrow) {
            this.manager.select(this, false);
        }
        return Clutter.EVENT_STOP;
    }

    // In-place rename: the label turns into an entry.
    rename() {
        const entry = new St.Entry({style_class: 'gnomac-desk-rename', text: this.label.text,
            width: this.actor.width - 6});
        this.label.hide();
        this.actor.add_child(entry);
        entry.grab_key_focus();
        const text = entry.clutter_text;
        const dot = this.label.text.lastIndexOf('.');
        text.set_selection(0, dot > 0 ? dot : -1);
        let done = false;
        const finish = commit => {
            if (done)
                return;
            done = true;
            const value = entry.text.trim();
            entry.destroy();
            this.label.show();
            this.manager.focusLayer();
            if (commit && value && value !== this.label.text) {
                try {
                    this.file.set_display_name(value, null);
                } catch (e) {
                    Main.notify('GNOMAC', `${t('Could not rename:', 'Renommage impossible :')} ${e.message}`);
                }
            }
        };
        text.connect('activate', () => finish(true));
        text.connect('key-focus-out', () => finish(true));
        text.connect('key-press-event', (_t, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    destroy() {
        this._endGrab();
        this.actor.destroy();
    }
}

export class DesktopIcons {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._tiles = new Map();
        this._ghost = null;
        this.lastClick = {tile: null, time: 0, x: 0, y: 0};
    }

    get tiles() {
        return [...this._tiles.values()];
    }

    get scale() {
        return uiScale() * (SIZES[this._settings.get_string('desktop-icons-size')] ?? 1);
    }

    enable() {
        this._extension.desktopIcons = this;
        this._dir = desktopPath();
        // The layer exists even without a Desktop folder: the desktop menu
        // (wallpaper, display settings) is useful on its own.
        this._desk = desktopLayer.acquire(this);
        this._layer = this._desk.actor;
        this._pressHandler = event => this._onEmptyPress(event);
        this._keyHandler = event => this._onKey(event);
        this._menuProvider = (menu, add, separator) => this._provideMenu(menu, add, separator);
        this._desk.pressHandlers.add(this._pressHandler);
        this._desk.keyHandlers.add(this._keyHandler);
        this._desk.menuProviders.add(this._menuProvider);
        if (!this._dir)
            return;
        this._file = Gio.File.new_for_path(this._dir);
        this._layout = this._loadLayout();
        this._refresh();
        try {
            this._monitor = this._file.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitorId = this._monitor.connect('changed', () => this._queueRefresh());
        } catch (e) {
            logError(e, 'GNOMAC desktop icons: cannot watch the folder');
        }
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._placeAll());
        this._visibleId = this._settings.connect('changed::desktop-icons-visible', () => this._syncVisible());
        this._syncVisible();
    }

    disable() {
        if (this._extension.desktopIcons === this)
            this._extension.desktopIcons = null;
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._visibleId) {
            this._settings.disconnect(this._visibleId);
            this._visibleId = 0;
        }
        if (this._desk) {
            this._desk.pressHandlers.delete(this._pressHandler);
            this._desk.keyHandlers.delete(this._keyHandler);
            this._desk.menuProviders.delete(this._menuProvider);
            this._desk.closeMenu();
        }
        this._ghost?.destroy();
        this._ghost = null;
        this._band?.destroy();
        this._band = null;
        for (const tile of this.tiles)
            tile.destroy();
        this._tiles.clear();
        this._desk?.release(this);
        this._desk = null;
        this._layer = null;
    }

    focusLayer() {
        this._desk?.focus();
    }

    _syncVisible() {
        const visible = this._settings.get_boolean('desktop-icons-visible');
        for (const tile of this.tiles)
            tile.actor.visible = visible;
        if (!visible)
            this._desk?.closeMenu();
    }

    // The icons of the desktop (the layer itself stays, for the menu).
    get iconsVisible() {
        return this._settings.get_boolean('desktop-icons-visible');
    }

    // -------------------------------------------------------------- layout

    _loadLayout() {
        try {
            const parsed = JSON.parse(this._settings.get_string('desktop-icons-layout') || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    _saveLayout() {
        const names = new Set(this._tiles.keys());
        for (const name of Object.keys(this._layout)) {
            if (!names.has(name))
                delete this._layout[name];
        }
        this._settings.set_string('desktop-icons-layout', JSON.stringify(this._layout));
    }

    _bounds() {
        const monitor = Main.layoutManager.primaryMonitor;
        const k = this.scale;
        const top = monitor.y + Main.panel.height + MARGIN;
        const cols = Math.max(1, Math.floor((monitor.width - 2 * MARGIN) / (CELL_W * k)));
        const rows = Math.max(1, Math.floor((monitor.height - Main.panel.height - 2 * MARGIN - 96 * uiScale()) / (CELL_H * k)));
        return {monitor, top, cols, rows, k};
    }

    _point(col, row) {
        const {monitor, top, k} = this._bounds();
        const left = this._settings.get_string('desktop-icons-side') === 'left';
        const x = left ? monitor.x + MARGIN + col * CELL_W * k
            : monitor.x + monitor.width - MARGIN - (col + 1) * CELL_W * k;
        return [Math.round(x), Math.round(top + row * CELL_H * k)];
    }

    _cellAt(x, y) {
        const {monitor, top, cols, rows, k} = this._bounds();
        const left = this._settings.get_string('desktop-icons-side') === 'left';
        let col = left ? Math.round((x - monitor.x - MARGIN) / (CELL_W * k))
            : Math.round((monitor.x + monitor.width - MARGIN - x) / (CELL_W * k)) - 1;
        let row = Math.round((y - top) / (CELL_H * k));
        col = Math.min(cols - 1, Math.max(0, col));
        row = Math.min(rows - 1, Math.max(0, row));
        return [col, row];
    }

    _taken(except) {
        const taken = new Set();
        for (const [name, cell] of Object.entries(this._layout)) {
            if (!except.has(name) && this._tiles.has(name))
                taken.add(`${cell[0]},${cell[1]}`);
        }
        return taken;
    }

    _freeCell(taken) {
        const {cols, rows} = this._bounds();
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                if (!taken.has(`${col},${row}`))
                    return [col, row];
            }
        }
        return [0, 0];
    }

    _nearestFree(wanted, taken) {
        if (!taken.has(`${wanted[0]},${wanted[1]}`))
            return wanted;
        const {cols, rows} = this._bounds();
        let best = null;
        let bestD = Infinity;
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                if (taken.has(`${col},${row}`))
                    continue;
                const d = (col - wanted[0]) ** 2 + (row - wanted[1]) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = [col, row];
                }
            }
        }
        return best ?? wanted;
    }

    _placeAll(animate = false) {
        for (const tile of this.tiles) {
            const cell = this._layout?.[tile.name];
            if (!cell)
                continue;
            const [x, y] = this._point(cell[0], cell[1]);
            if (animate)
                tile.actor.ease({x, y, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            else
                tile.actor.set_position(x, y);
        }
    }

    // Sort by name, type, date or size: the icons are laid out again, column
    // after column from the side they start on.
    sortBy(kind) {
        const tiles = this.tiles;
        const compare = {
            name: (a, b) => a.info.get_display_name().localeCompare(b.info.get_display_name()),
            type: (a, b) => (a.info.get_content_type() ?? '').localeCompare(b.info.get_content_type() ?? '') ||
                a.info.get_display_name().localeCompare(b.info.get_display_name()),
            date: (a, b) => b.info.get_modification_date_time().to_unix() - a.info.get_modification_date_time().to_unix(),
            size: (a, b) => b.info.get_size() - a.info.get_size(),
        }[kind];
        const {rows} = this._bounds();
        tiles.sort(compare).forEach((tile, i) => {
            this._layout[tile.name] = [Math.floor(i / rows), i % rows];
        });
        this._saveLayout();
        this._placeAll(true);
    }

    // ------------------------------------------------------------- content

    _queueRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        let infos = [];
        try {
            const enumerator = this._file.enumerate_children(ATTRS, Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) && infos.length < MAX_ITEMS) {
                if (!info.get_is_hidden())
                    infos.push(info);
            }
        } catch (e) {
            logError(e, 'GNOMAC desktop icons: cannot read the Desktop folder');
            infos = [];
        }
        infos.sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

        const wanted = new Set(infos.map(i => i.get_name()));
        for (const [name, tile] of [...this._tiles]) {
            if (!wanted.has(name)) {
                tile.destroy();
                this._tiles.delete(name);
            }
        }
        const visible = this.iconsVisible;
        for (const info of infos) {
            const name = info.get_name();
            if (this._tiles.has(name))
                continue;
            const tile = new IconTile(this, info, this._file.get_child(name));
            this._tiles.set(name, tile);
            this._layer.add_child(tile.actor);
            tile.actor.visible = visible;
            if (!this._layout[name])
                this._layout[name] = this._freeCell(this._taken(new Set([name])));
            const [x, y] = this._point(...this._layout[name]);
            tile.actor.set_position(x, y);
            if (this._announced) {
                tile.actor.opacity = 0;
                tile.actor.ease({opacity: 255, duration: 220});
            }
        }
        this._announced = true;
        this._saveLayout();
        if (this._pendingRename && this._tiles.has(this._pendingRename)) {
            const name = this._pendingRename;
            this._pendingRename = null;
            this.select(this._tiles.get(name), false);
            this._tiles.get(name).rename();
        }
    }

    // ----------------------------------------------------------- selection

    select(tile, additive) {
        for (const other of this.tiles) {
            if (other === tile)
                continue;
            if (!additive)
                other.setSelected(false);
        }
        tile.setSelected(additive ? !tile.selected : true);
    }

    selectAll() {
        this.tiles.forEach(tile => tile.setSelected(true));
    }

    clearSelection() {
        this.tiles.forEach(tile => tile.setSelected(false));
    }

    selected() {
        return this.tiles.filter(tile => tile.selected);
    }

    // The desktop itself: a primary press on an empty spot clears the
    // selection and starts a selection rectangle.
    _onEmptyPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return false;
        const [x, y] = event.get_coords();
        const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if (!ctrl)
            this.clearSelection();
        this._startBand(x, y, ctrl);
        return true;
    }

    // Rubber band: drag on an empty spot to select what it touches.
    _startBand(x0, y0, additive) {
        const base = new Set(additive ? this.selected() : []);
        let band = null;
        let grab = null;
        try {
            grab = global.stage.grab(this._layer);
        } catch (e) {
            logError(e, 'GNOMAC desktop icons: selection grab');
            return;
        }
        const motionId = this._layer.connect('motion-event', (_a, event) => {
            const [x, y] = event.get_coords();
            if (!band && Math.hypot(x - x0, y - y0) < DRAG_THRESHOLD * uiScale())
                return Clutter.EVENT_STOP;
            if (!band) {
                band = new St.Widget({style_class: 'gnomac-desk-band', reactive: false});
                this._layer.add_child(band);
            }
            const left = Math.min(x0, x);
            const top = Math.min(y0, y);
            const width = Math.abs(x - x0);
            const height = Math.abs(y - y0);
            band.set_position(left, top);
            band.set_size(width, height);
            for (const tile of this.tiles) {
                const a = tile.actor;
                const hit = a.visible && a.x < left + width && a.x + a.width > left && a.y < top + height && a.y + a.height > top;
                tile.setSelected(hit || base.has(tile));
            }
            return Clutter.EVENT_STOP;
        });
        const releaseId = this._layer.connect('button-release-event', () => {
            this._layer.disconnect(motionId);
            this._layer.disconnect(releaseId);
            band?.destroy();
            try {
                grab.dismiss();
            } catch {}
            return Clutter.EVENT_STOP;
        });
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const chosen = this.selected();
        if (ctrl) {
            switch (key) {
            case Clutter.KEY_a:
            case Clutter.KEY_A:
                this.selectAll();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_c:
            case Clutter.KEY_C:
                this.copy(chosen, false);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_x:
            case Clutter.KEY_X:
                this.copy(chosen, true);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_v:
            case Clutter.KEY_V:
                this.paste();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        switch (key) {
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            chosen.forEach(tile => this.open(tile));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_F2:
            chosen[0]?.rename();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Delete:
            if (chosen.length)
                this.trash(chosen);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_F5:
            this._queueRefresh();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // -------------------------------------------------------------- actions

    open(tile) {
        try {
            Gio.AppInfo.launch_default_for_uri(tile.uri(), global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notify('GNOMAC', `${t('Could not open it:', 'Ouverture impossible :')} ${e.message}`);
        }
    }

    trash(tiles) {
        for (const tile of tiles) {
            try {
                tile.file.trash(null);
            } catch (e) {
                Main.notify('GNOMAC', `${t('Could not move to the Trash:', 'Mise à la corbeille impossible :')} ${e.message}`);
            }
        }
    }

    toShelf(tiles) {
        const island = this._extension._modules?.find(m => m.constructor.name === 'DynamicIsland');
        for (const tile of tiles)
            island?.island?.shelf?.add(tile.uri());
        if (island && tiles.length)
            Main.notify('GNOMAC', t('Kept on the notch shelf.', 'Gardé sur l’étagère de l’encoche.'));
    }

    // Puts the files on the clipboard the way Files does, so Ctrl+V in Files
    // (or "Paste" here) copies or moves them.
    copy(tiles, cut) {
        if (!tiles.length)
            return;
        const text = `${cut ? 'cut' : 'copy'}\n${tiles.map(tile => tile.uri()).join('\n')}`;
        const clipboard = St.Clipboard.get_default();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', new GLib.Bytes(new TextEncoder().encode(text)));
    }

    // While dragging: a ghost shows the cell the icon will take; over the
    // notch the ghost turns into a "keep on the shelf" hint.
    dragOver(tile, x, y) {
        if (!this._ghost) {
            this._ghost = new St.Widget({style_class: 'gnomac-desk-ghost', reactive: false});
            this._layer.insert_child_below(this._ghost, tile.actor);
        }
        const onNotch = this._overNotch(x, y);
        const [col, row] = this._nearestFree(this._cellAt(x - tile.actor.width / 2, y - tile.actor.height / 2),
            this._taken(new Set([tile.name])));
        const [gx, gy] = this._point(col, row);
        this._ghost.set_size(tile.actor.width, tile.actor.height);
        this._ghost.set_position(gx, gy);
        this._ghost.opacity = onNotch ? 0 : 255;
    }

    _overNotch(x, y) {
        const island = this._extension._modules?.find(m => m.constructor.name === 'DynamicIsland')?.island;
        if (!island?.visible)
            return false;
        const [ix, iy] = island.get_transformed_position();
        return x >= ix && x <= ix + island.width && y >= iy && y <= iy + Math.max(island.height, 40);
    }

    // `tiles` are the icons that moved together; `anchor` is the one held.
    drop(_anchor, tiles, x, y) {
        this._ghost?.destroy();
        this._ghost = null;
        if (this._overNotch(x, y)) {
            this.toShelf(tiles);
            this._placeAll(true);
            return;
        }
        const moving = new Set(tiles.map(tl => tl.name));
        const taken = this._taken(moving);
        // Each icon takes the free cell nearest to where it was dropped.
        for (const tile of tiles) {
            const [col, row] = this._cellAt(tile.actor.x, tile.actor.y);
            const cell = this._nearestFree([col, row], taken);
            taken.add(`${cell[0]},${cell[1]}`);
            this._layout[tile.name] = cell;
        }
        this._saveLayout();
        this._placeAll(true);
    }

    // ---------------------------------------------------------------- menus

    openMenu(tile, x, y) {
        const chosen = this.selected();
        this._desk.popup(x, y, (_menu, add, separator) => {
            add(t('Open', 'Ouvrir'), () => chosen.forEach(tl => this.open(tl)));
            add(t('Rename…', 'Renommer…'), () => tile.rename());
            separator();
            add(t('Cut', 'Couper'), () => this.copy(chosen, true));
            add(t('Copy', 'Copier'), () => this.copy(chosen, false));
            add(t('Copy Path', 'Copier le chemin'), () =>
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, chosen.map(tl => tl.file.get_path()).join('\n')));
            add(t('Keep on the Notch Shelf', 'Garder sur l’étagère de l’encoche'), () => this.toShelf(chosen));
            separator();
            add(t('Move to Trash', 'Mettre à la corbeille'), () => this.trash(chosen));
        });
    }

    // Our part of the desktop menu (the layer adds the wallpaper and display
    // entries after every module's).
    _provideMenu(menu, add, separator) {
        if (this._dir) {
            add(t('New Folder', 'Nouveau dossier'), () => this.newFolder());
            add(t('New Text Document', 'Nouveau document texte'), () => this.newDocument());
            add(t('Paste', 'Coller'), () => this.paste());
            separator();
            const sort = new PopupMenu.PopupSubMenuMenuItem(t('Sort By', 'Trier par'));
            for (const [kind, label] of [['name', t('Name', 'Nom')], ['type', t('Type', 'Type')],
                ['date', t('Date Modified', 'Date de modification')], ['size', t('Size', 'Taille')]])
                add(label, () => this.sortBy(kind), sort.menu);
            menu.addMenuItem(sort);
            add(t('Refresh', 'Actualiser'), () => this._queueRefresh());
            add(t('Select All', 'Tout sélectionner'), () => this.selectAll());
            separator();
        }
        const show = add(t('Show Desktop Items', 'Afficher les éléments du bureau'), () =>
            this._settings.set_boolean('desktop-icons-visible', !this.iconsVisible));
        show.setOrnament(this.iconsVisible ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        if (this._dir) {
            add(t('Open Desktop Folder', 'Ouvrir le dossier Bureau'), () =>
                Gio.AppInfo.launch_default_for_uri(this._file.get_uri(), global.create_app_launch_context(0, -1)));
            add(t('Open in Terminal', 'Ouvrir dans le terminal'), () => this.openTerminal());
        }
    }

    openTerminal() {
        for (const argv of [['ptyxis', '--working-directory', this._dir], ['kgx', '--working-directory', this._dir],
            ['gnome-terminal', `--working-directory=${this._dir}`], ['alacritty', '--working-directory', this._dir],
            ['foot', '-D', this._dir], ['kitty', '-d', this._dir], ['xterm']]) {
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return;
            } catch {
                // Not installed: the next one.
            }
        }
        Main.notify('GNOMAC', t('No terminal found.', 'Aucun terminal trouvé.'));
    }

    _uniqueName(base, extension = '') {
        let name = `${base}${extension}`;
        for (let i = 2; this._file.get_child(name).query_exists(null); i++)
            name = `${base} ${i}${extension}`;
        return name;
    }

    newFolder() {
        const name = this._uniqueName(t('untitled folder', 'dossier sans titre'));
        try {
            this._file.get_child(name).make_directory(null);
            this._pendingRename = name;
            this._queueRefresh();
        } catch (e) {
            Main.notify('GNOMAC', `${t('Could not create the folder:', 'Création impossible :')} ${e.message}`);
        }
    }

    newDocument() {
        const name = this._uniqueName(t('New Text Document', 'Nouveau document texte'), '.txt');
        try {
            this._file.get_child(name).create(Gio.FileCreateFlags.NONE, null).close(null);
            this._pendingRename = name;
            this._queueRefresh();
        } catch (e) {
            Main.notify('GNOMAC', `${t('Could not create the file:', 'Création impossible :')} ${e.message}`);
        }
    }

    // Files copied (or cut) in the Files app, or any text/uri-list.
    paste() {
        const clipboard = St.Clipboard.get_default();
        const apply = (bytes, move) => {
            const text = bytes ? new TextDecoder().decode(bytes.get_data?.() ?? bytes) : '';
            const uris = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('file://'));
            if (!uris.length) {
                Main.notify('GNOMAC', t('There are no files to paste.', 'Aucun fichier à coller.'));
                return;
            }
            for (const uri of uris) {
                const source = Gio.File.new_for_uri(uri).get_path();
                if (!source)
                    continue;
                const argv = move ? ['mv', '-n', '--', source, `${this._dir}/`] : ['cp', '-rn', '--', source, `${this._dir}/`];
                try {
                    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                } catch (e) {
                    logError(e, 'GNOMAC desktop icons: paste');
                }
            }
        };
        clipboard.get_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', (_c, bytes) => {
            const text = bytes ? new TextDecoder().decode(bytes.get_data?.() ?? bytes) : '';
            if (text.startsWith('cut') || text.startsWith('copy')) {
                apply(bytes, text.startsWith('cut'));
                return;
            }
            clipboard.get_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', (_c2, list) => apply(list, false));
        });
    }
}
