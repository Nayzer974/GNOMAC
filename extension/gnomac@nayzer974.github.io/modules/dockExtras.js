// The right end of the macOS dock: the Downloads stack (opens as a fan of
// recent files) and the Trash (empty/full icon, open, empty with a
// confirmation).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const FAN_ITEMS = 10;
const FAN_ICON = 52;

function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        logError(e, `GNOMAC: cannot open ${uri}`);
    }
}

export function downloadsDir() {
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
}

// ---------------------------------------------------------------- Trash

export class TrashWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this.full = false;
        this._file = Gio.File.new_for_uri('trash:///');
        try {
            this._monitor = this._file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', () => this._refresh());
        } catch (e) {
            logError(e, 'GNOMAC: trash monitor');
        }
        this._refresh();
    }

    _refresh() {
        this._file.query_info_async('trash::item-count', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, null, (file, result) => {
                try {
                    const info = file.query_info_finish(result);
                    const full = info.get_attribute_uint32('trash::item-count') > 0;
                    if (full !== this.full) {
                        this.full = full;
                        this._onChange?.(full);
                    }
                } catch {}
            });
    }

    get iconName() {
        return this.full ? 'user-trash-full' : 'user-trash';
    }

    destroy() {
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        this._onChange = null;
    }
}

export function openTrash() {
    openUri('trash:///');
}

// Deleting is irreversible, so ask first, like Finder does.
export function confirmEmptyTrash() {
    const dialog = new ModalDialog.ModalDialog({styleClass: 'gnomac-confirm-dialog'});
    const content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gnomac-confirm-content',
    });
    content.add_child(new St.Label({
        text: t('Are you sure you want to permanently erase the items in the Trash?',
            'Voulez-vous vraiment supprimer définitivement les éléments de la Corbeille ?'),
        style_class: 'gnomac-confirm-title',
    }));
    content.add_child(new St.Label({
        text: t('You can’t undo this action.', 'Cette action est irréversible.'),
        style_class: 'gnomac-confirm-body',
    }));
    dialog.contentLayout.add_child(content);
    dialog.setButtons([
        {label: t('Cancel', 'Annuler'), action: () => dialog.close(), key: Clutter.KEY_Escape},
        {
            label: t('Empty Trash', 'Vider la Corbeille'),
            action: () => {
                dialog.close();
                emptyTrash();
            },
            default: true,
        },
    ]);
    dialog.open();
}

function emptyTrash() {
    // `gio trash --empty` goes through the same GVfs backend as Files.
    try {
        Gio.Subprocess.new(['gio', 'trash', '--empty'], Gio.SubprocessFlags.NONE);
    } catch (e) {
        logError(e, 'GNOMAC: empty trash');
    }
}

// ---------------------------------------------------------------- Downloads

async function recentDownloads() {
    const dir = Gio.File.new_for_path(downloadsDir());
    const files = [];
    try {
        const enumerator = dir.enumerate_children(
            'standard::name,standard::display-name,standard::icon,standard::is-hidden,time::modified,thumbnail::path',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_is_hidden())
                continue;
            files.push({
                file: dir.get_child(info.get_name()),
                name: info.get_display_name(),
                icon: info.get_icon(),
                thumbnail: info.get_attribute_byte_string('thumbnail::path'),
                modified: info.get_modification_date_time()?.to_unix() ?? 0,
            });
        }
        enumerator.close(null);
    } catch {
        return [];
    }
    files.sort((a, b) => b.modified - a.modified);
    return files.slice(0, FAN_ITEMS);
}

const FanItem = GObject.registerClass(
class FanItem extends St.BoxLayout {
    _init(entry) {
        super._init({style_class: 'gnomac-fan-item', reactive: true, track_hover: true});
        this.entry = entry;
        const label = new St.Label({
            text: entry.name,
            style_class: 'gnomac-fan-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        const icon = entry.thumbnail
            ? new St.Widget({
                style_class: 'gnomac-fan-thumb',
                style: `background-image: url("file://${entry.thumbnail}"); width: ${FAN_ICON}px; height: ${FAN_ICON}px;`,
            })
            : new St.Icon({gicon: entry.icon, icon_size: FAN_ICON});
        this.add_child(label);
        this.add_child(icon);
    }
});

// macOS "Fan": files rise from the stack icon along a gentle arc, labels on
// the left, each item on its own spring with a small stagger.
export class DownloadsStack {
    constructor() {
        this._root = null;
        this._items = [];
        this._tick = dt => this._onTick(dt);
    }

    get isOpen() {
        return !!this._root;
    }

    async open(anchor) {
        if (this._root) {
            this.close();
            return;
        }
        const entries = await recentDownloads();
        const monitor = Main.layoutManager.primaryMonitor;

        this._root = new St.Widget({reactive: true, x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height});
        // Clicks on the fan items bubble up here too: only close on clicks
        // that land on the empty backdrop.
        this._root.connect('button-press-event', (actor, event) => {
            if (global.stage.get_event_actor(event) !== actor)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.uiGroup.add_child(this._root);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        this._root.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this.close();
            return Clutter.EVENT_STOP;
        });
        global.stage.set_key_focus(this._root);

        const [ax, ay] = anchor.get_transformed_position();
        const [aw] = anchor.get_transformed_size();
        this._originX = ax + aw / 2 - monitor.x;
        this._originY = ay - monitor.y;

        const all = [...entries.map(e => ({entry: e}))];
        all.push({
            more: true,
            label: t('Open in Files', 'Ouvrir dans Fichiers'),
        });

        this._items = all.map((spec, i) => {
            let actor;
            if (spec.more) {
                actor = new St.Button({
                    label: spec.label,
                    style_class: 'gnomac-fan-more',
                });
                actor.connect('clicked', () => {
                    this.close();
                    openUri(Gio.File.new_for_path(downloadsDir()).get_uri());
                });
            } else {
                actor = new FanItem(spec.entry);
                actor.connect('button-release-event', () => {
                    this.close();
                    openUri(spec.entry.file.get_uri());
                    return Clutter.EVENT_STOP;
                });
            }
            this._root.add_child(actor);
            const spring = new Spring({stiffness: 300, damping: 22, value: 0});
            return {actor, spring, delay: i * 0.025, index: i};
        });

        if (!entries.length) {
            const empty = new St.Label({
                text: t('No downloads', 'Aucun téléchargement'),
                style_class: 'gnomac-fan-empty',
            });
            this._root.add_child(empty);
            this._items.unshift({actor: empty, spring: new Spring({stiffness: 300, damping: 22}), delay: 0, index: 0});
            this._items.forEach((item, i) => (item.index = i));
        }

        this._elapsed = 0;
        for (const item of this._items)
            item.spring.setTarget(1);
        getTicker().add(this._tick);
    }

    _onTick(dt) {
        if (!this._root)
            return false;
        this._elapsed += dt;
        let moving = false;
        const n = this._items.length;
        for (const item of this._items) {
            if (this._elapsed >= item.delay)
                item.spring.step(dt);
            moving ||= !item.spring.settled;
            const p = item.spring.value;
            const step = FAN_ICON + 10;
            // Arc: higher items drift right and tilt a little, like the Fan.
            const rank = n - 1 - item.index;
            const rise = (rank + 1) * step;
            const drift = (rank / Math.max(1, n - 1)) ** 2 * 60;
            const [width, height] = item.actor.get_size();
            item.actor.set_pivot_point(1, 0.5);
            item.actor.rotation_angle_z = -(rank / Math.max(1, n - 1)) * 8 * p;
            item.actor.set_position(
                Math.round(this._originX - width + FAN_ICON / 2 + drift * p),
                Math.round(this._originY - rise * p - height / 2 + 8));
            item.actor.opacity = Math.round(255 * Math.min(1, p * 1.5));
        }
        return moving;
    }

    close() {
        if (!this._root)
            return;
        getTicker().remove(this._tick);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const root = this._root;
        this._root = null;
        this._items = [];
        root.ease({
            opacity: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => root.destroy(),
        });
    }

    destroy() {
        this.close();
    }
}
