// Icons on the desktop: the files and folders of your Desktop folder, shown on
// the wallpaper and usable like on macOS:
//   - click selects (Ctrl+click adds), double-click opens,
//   - drag an icon to move it (it snaps to a grid and is remembered), or drop
//     it on the notch to keep it on the shelf,
//   - right-click: Open, Rename, Copy Path, Send to the Shelf, Move to Trash,
//   - right-click the desktop: New Folder, Paste (files copied in Files),
//   - the folder is watched: files added, renamed or deleted elsewhere appear
//     at once.
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

import {uiScale} from '../lib/ui.js';
import {t} from '../lib/i18n.js';

const CELL_W = 96;
const CELL_H = 108;
const ICON = 58;
const MARGIN = 14;
const MAX_ITEMS = 240;
const ATTRS = 'standard::name,standard::display-name,standard::icon,standard::is-hidden,thumbnail::path,standard::type';
const SIZES = {small: 0.85, medium: 1, large: 1.25};

function desktopPath() {
    const dir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
    // When there is no Desktop folder the setting points at $HOME: show nothing.
    return dir && dir !== GLib.get_home_dir() ? dir : null;
}

class IconTile {
    constructor(manager, info, file) {
        this.manager = manager;
        this.file = file;
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
        let drag = null;
        this.actor.connect('button-press-event', (_a, event) => {
            const button = event.get_button();
            if (button === Clutter.BUTTON_SECONDARY) {
                if (!this.selected)
                    this.manager.select(this, false);
                this.manager.openMenu(this);
                return Clutter.EVENT_STOP;
            }
            if (button !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (event.get_click_count() === 2) {
                this.manager.open(this);
                return Clutter.EVENT_STOP;
            }
            this.manager.select(this, ctrl);
            const [x, y] = event.get_coords();
            drag = {x, y, ox: this.actor.x, oy: this.actor.y, moved: false};
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('motion-event', (_a, event) => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 6)
                return Clutter.EVENT_STOP;
            if (!drag.moved) {
                drag.moved = true;
                Main.layoutManager._backgroundGroup.set_child_above_sibling(this.actor, null);
                this.actor.ease({scale_x: 1.06, scale_y: 1.06, opacity: 220, duration: 120});
            }
            this.actor.set_position(Math.round(drag.ox + x - drag.x), Math.round(drag.oy + y - drag.y));
            this.manager.dragOver(this, x, y);
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-release-event', (_a, event) => {
            if (!drag)
                return Clutter.EVENT_PROPAGATE;
            const moved = drag.moved;
            drag = null;
            if (moved) {
                this.actor.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 140});
                const [x, y] = event.get_coords();
                this.manager.drop(this, x, y);
            }
            return Clutter.EVENT_STOP;
        });
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
        this.actor.destroy();
    }
}

export class DesktopIcons {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._tiles = new Map();
        this._ghost = null;
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
        this._overviewIds = [
            Main.overview.connect('showing', () => this.tiles.forEach(tile => tile.actor.hide())),
            Main.overview.connect('hidden', () => this.tiles.forEach(tile => tile.actor.show())),
        ];
        this._addDesktopMenuItems();
        this._clearOnClick();
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
        for (const id of this._overviewIds ?? [])
            Main.overview.disconnect(id);
        this._overviewIds = [];
        for (const [object, id] of this._bgIds ?? []) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._bgIds = [];
        for (const item of this._menuItems ?? [])
            item.destroy();
        this._menuItems = [];
        this._menu?.destroy();
        this._menu = null;
        this._ghost?.destroy();
        this._ghost = null;
        for (const tile of this.tiles)
            tile.destroy();
        this._tiles.clear();
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

    _taken(exceptName) {
        const taken = new Set();
        for (const [name, cell] of Object.entries(this._layout)) {
            if (name !== exceptName && this._tiles.has(name))
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

    _nearestFree(wanted, exceptName) {
        const taken = this._taken(exceptName);
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
            const cell = this._layout[tile.name];
            if (!cell)
                continue;
            const [x, y] = this._point(cell[0], cell[1]);
            if (animate)
                tile.actor.ease({x, y, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            else
                tile.actor.set_position(x, y);
        }
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
        const group = Main.layoutManager._backgroundGroup;
        for (const info of infos) {
            const name = info.get_name();
            if (this._tiles.has(name))
                continue;
            const tile = new IconTile(this, info, this._file.get_child(name));
            this._tiles.set(name, tile);
            group.add_child(tile.actor);
            if (!this._layout[name])
                this._layout[name] = this._freeCell(this._taken(name));
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

    _clearOnClick() {
        this._bgIds = [];
        for (const manager of Main.layoutManager._bgManagers ?? []) {
            const actor = manager.backgroundActor;
            if (!actor)
                continue;
            this._bgIds.push([actor, actor.connect('button-press-event', (_a, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY)
                    this.tiles.forEach(tile => tile.setSelected(false));
                return Clutter.EVENT_PROPAGATE;
            })]);
        }
    }

    _selected() {
        return this.tiles.filter(tile => tile.selected);
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

    // While dragging: a ghost shows the cell the icon will take; over the
    // notch the ghost turns into a "keep on the shelf" hint.
    dragOver(tile, x, y) {
        if (!this._ghost) {
            this._ghost = new St.Widget({style_class: 'gnomac-desk-ghost', reactive: false});
            Main.layoutManager._backgroundGroup.insert_child_below(this._ghost, tile.actor);
        }
        const onNotch = this._overNotch(x, y);
        const [col, row] = this._nearestFree(this._cellAt(x - tile.actor.width / 2, y - tile.actor.height / 2), tile.name);
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

    drop(tile, x, y) {
        this._ghost?.destroy();
        this._ghost = null;
        if (this._overNotch(x, y)) {
            this.toShelf([tile]);
            this._placeAll(true);
            return;
        }
        const [col, row] = this._nearestFree(this._cellAt(x - tile.actor.width / 2, y - tile.actor.height / 2), tile.name);
        this._layout[tile.name] = [col, row];
        this._saveLayout();
        this._placeAll(true);
    }

    // ---------------------------------------------------------------- menus

    openMenu(tile) {
        this._menu?.destroy();
        const menu = new PopupMenu.PopupMenu(tile.actor, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        const add = (label, action) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', action);
            menu.addMenuItem(item);
        };
        const chosen = this._selected();
        add(t('Open', 'Ouvrir'), () => chosen.forEach(tl => this.open(tl)));
        add(t('Rename…', 'Renommer…'), () => tile.rename());
        add(t('Copy Path', 'Copier le chemin'), () =>
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, chosen.map(tl => tl.file.get_path()).join('\n')));
        add(t('Keep on the Notch Shelf', 'Garder sur l’étagère de l’encoche'), () => this.toShelf(chosen));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        add(t('Move to Trash', 'Mettre à la corbeille'), () => this.trash(chosen));
        menu.open(true);
        this._menu = menu;
    }

    _addDesktopMenuItems() {
        this._menuItems = [];
        for (const manager of Main.layoutManager._bgManagers ?? []) {
            const menu = manager.backgroundActor?._backgroundMenu;
            if (!menu)
                continue;
            const folder = new PopupMenu.PopupMenuItem(t('New Folder', 'Nouveau dossier'));
            folder.connect('activate', () => this.newFolder());
            menu.addMenuItem(folder, 0);
            const paste = new PopupMenu.PopupMenuItem(t('Paste', 'Coller'));
            paste.connect('activate', () => this.paste());
            menu.addMenuItem(paste, 1);
            this._menuItems.push(folder, paste);
        }
    }

    newFolder() {
        const base = t('untitled folder', 'dossier sans titre');
        let name = base;
        for (let i = 2; this._file.get_child(name).query_exists(null); i++)
            name = `${base} ${i}`;
        try {
            this._file.get_child(name).make_directory(null);
            this._pendingRename = name;
            this._queueRefresh();
        } catch (e) {
            Main.notify('GNOMAC', `${t('Could not create the folder:', 'Création impossible :')} ${e.message}`);
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
