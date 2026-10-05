// macOS menu bar menus for the focused app: File, Edit, View, (app extras
// such as Spotify's Playback), Window, Help. Like RevoShell's TopBar, the
// menus are described here rather than read from the app (GTK 4 apps no
// longer export menus); items send the app's real keyboard shortcut or act
// on its window through mutter, and show the shortcut macOS-style.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {sendShortcut, shortcutLabel} from '../lib/keys.js';
import {t} from '../lib/i18n.js';

const focusWindow = () => global.display.focus_window;

function toggleMaximize() {
    const w = focusWindow();
    if (!w)
        return;
    if (w.maximized_horizontally && w.maximized_vertically)
        w.unmaximize(Meta.MaximizeFlags.BOTH);
    else
        w.maximize(Meta.MaximizeFlags.BOTH);
}

function centerWindow() {
    const w = focusWindow();
    if (!w)
        return;
    const area = w.get_work_area_current_monitor();
    const rect = w.get_frame_rect();
    w.move_frame(true, area.x + (area.width - rect.width) / 2, area.y + (area.height - rect.height) / 2);
}

function toggleFullscreen() {
    const w = focusWindow();
    if (!w)
        return;
    if (w.is_fullscreen())
        w.unmake_fullscreen();
    else
        w.make_fullscreen();
}

function hideApp(app) {
    for (const w of app?.get_windows() ?? [])
        w.minimize();
}

function hideOthers(app) {
    const tracker = Shell.WindowTracker.get_default();
    for (const actor of global.get_window_actors()) {
        const w = actor.meta_window;
        if (w.get_window_type() === Meta.WindowType.NORMAL && tracker.get_window_app(w) !== app)
            w.minimize();
    }
}

// Entries: [label, shortcut | null, action] or null for a separator.
// `key` actions send the shortcut; functions run directly.
function standardMenus(app) {
    const name = app?.get_name() ?? t('Desktop', 'Bureau');
    const key = combo => () => sendShortcut(combo);
    return [
        {title: t('File', 'Fichier'), items: [
            [t('New Window', 'Nouvelle fenêtre'), 'ctrl+n', () => app?.open_new_window(-1)],
            [t('New Tab', 'Nouvel onglet'), 'ctrl+t', key('ctrl+t')],
            [t('Open…', 'Ouvrir…'), 'ctrl+o', key('ctrl+o')],
            null,
            [t('Save', 'Enregistrer'), 'ctrl+s', key('ctrl+s')],
            [t('Print…', 'Imprimer…'), 'ctrl+p', key('ctrl+p')],
            null,
            [t('Close Window', 'Fermer la fenêtre'), 'ctrl+w', () => focusWindow()?.delete(global.get_current_time())],
        ]},
        {title: t('Edit', 'Édition'), items: [
            [t('Undo', 'Annuler'), 'ctrl+z', key('ctrl+z')],
            [t('Redo', 'Rétablir'), 'ctrl+shift+z', key('ctrl+shift+z')],
            null,
            [t('Cut', 'Couper'), 'ctrl+x', key('ctrl+x')],
            [t('Copy', 'Copier'), 'ctrl+c', key('ctrl+c')],
            [t('Paste', 'Coller'), 'ctrl+v', key('ctrl+v')],
            [t('Select All', 'Tout sélectionner'), 'ctrl+a', key('ctrl+a')],
            null,
            [t('Find…', 'Rechercher…'), 'ctrl+f', key('ctrl+f')],
        ]},
        {title: t('View', 'Présentation'), items: [
            [t('Zoom In', 'Agrandir'), 'ctrl+plus', key('ctrl+plus')],
            [t('Zoom Out', 'Réduire'), 'ctrl+minus', key('ctrl+minus')],
            [t('Actual Size', 'Taille réelle'), 'ctrl+0', key('ctrl+0')],
            null,
            [t('Enter Full Screen', 'Passer en plein écran'), 'F11', toggleFullscreen],
        ]},
        ...extraMenus(app),
        {title: t('Window', 'Fenêtre'), items: [
            [t('Minimize', 'Placer dans le Dock'), 'super+h', () => focusWindow()?.minimize()],
            [t('Zoom', 'Réduire/agrandir'), 'super+Up', toggleMaximize],
            [t('Center', 'Centrer'), null, centerWindow],
            null,
            [t('Bring All to Front', 'Tout ramener au premier plan'), null, () => {
                for (const w of app?.get_windows() ?? [])
                    w.activate(global.get_current_time());
            }],
        ]},
        {title: t('Help', 'Aide'), items: [
            [t(`${name} Help`, `Aide ${name}`), 'F1', key('F1')],
            [t('Keyboard Shortcuts', 'Raccourcis clavier'), 'ctrl+question', key('ctrl+question')],
        ]},
    ];
}

// Flat list of every menu item of `app` (for Spotlight's Menu Items mode).
export function menuEntries(app) {
    const entries = [];
    for (const menu of standardMenus(app)) {
        for (const entry of menu.items) {
            if (!entry)
                continue;
            const [label, shortcut, action] = entry;
            entries.push({menu: menu.title, label, shortcut, action});
        }
    }
    return entries;
}

// App-specific menus, as in RevoShell's per-app TopBar configuration.
function extraMenus(app) {
    const id = app?.get_id() ?? '';
    const key = combo => () => sendShortcut(combo);
    if (id.includes('spotify')) {
        return [{title: t('Playback', 'Lecture'), items: [
            [t('Play/Pause', 'Lecture/Pause'), 'space', key('space')],
            [t('Next', 'Suivant'), 'ctrl+Right', key('ctrl+Right')],
            [t('Previous', 'Précédent'), 'ctrl+Left', key('ctrl+Left')],
            null,
            [t('Volume Up', 'Volume +'), 'ctrl+Up', key('ctrl+Up')],
            [t('Volume Down', 'Volume −'), 'ctrl+Down', key('ctrl+Down')],
        ]}];
    }
    if (id.includes('firefox') || id.includes('chrom') || id.includes('brave')) {
        return [{title: t('History', 'Historique'), items: [
            [t('Back', 'Précédent'), 'alt+Left', key('alt+Left')],
            [t('Forward', 'Suivant'), 'alt+Right', key('alt+Right')],
            [t('Show All History', 'Afficher tout l’historique'), 'ctrl+h', key('ctrl+h')],
        ]}, {title: t('Bookmarks', 'Signets'), items: [
            [t('Bookmark This Page', 'Ajouter cette page aux signets'), 'ctrl+d', key('ctrl+d')],
            [t('Show All Bookmarks', 'Afficher tous les signets'), 'ctrl+shift+o', key('ctrl+shift+o')],
        ]}];
    }
    if (id.includes('Nautilus')) {
        return [{title: t('Go', 'Aller'), items: [
            [t('Back', 'Précédent'), 'alt+Left', key('alt+Left')],
            [t('Forward', 'Suivant'), 'alt+Right', key('alt+Right')],
            [t('Enclosing Folder', 'Dossier parent'), 'alt+Up', key('alt+Up')],
            null,
            [t('Home', 'Dossier personnel'), 'alt+Home', key('alt+Home')],
            [t('Go to Folder…', 'Aller au dossier…'), 'ctrl+l', key('ctrl+l')],
        ]}];
    }
    if (id.includes('Ptyxis') || id.includes('Terminal') || id.includes('Console')) {
        return [{title: t('Shell', 'Shell'), items: [
            [t('New Tab', 'Nouvel onglet'), 'ctrl+shift+t', key('ctrl+shift+t')],
            [t('Copy', 'Copier'), 'ctrl+shift+c', key('ctrl+shift+c')],
            [t('Paste', 'Coller'), 'ctrl+shift+v', key('ctrl+shift+v')],
        ]}];
    }
    return [];
}

const MenuTitle = GObject.registerClass(
class MenuTitle extends PanelMenu.Button {
    _init(spec) {
        super._init(0.0, `GNOMAC ${spec.title}`);
        this.add_style_class_name('gnomac-menu-title');
        this.add_child(new St.Label({text: spec.title, y_align: Clutter.ActorAlign.CENTER}));
        for (const entry of spec.items) {
            if (!entry) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }
            const [label, shortcut, action] = entry;
            const item = new PopupMenu.PopupMenuItem(label);
            if (shortcut) {
                item.add_child(new St.Label({
                    text: shortcutLabel(shortcut),
                    style_class: 'gnomac-menu-shortcut',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.END,
                }));
            }
            item.connect('activate', () => {
                try {
                    action();
                } catch (e) {
                    logError(e, 'GNOMAC app menu');
                }
            });
            this.menu.addMenuItem(item);
        }
    }
});

export class AppMenus {
    constructor(extension) {
        this._extension = extension;
        this._buttons = [];
    }

    enable() {
        // The notch changes width: re-fit the menus whenever it does.
        this._notchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 400, () => {
            // During shell shutdown the UI group dies before disable() runs.
            if (Main.layoutManager._startingUp || !Main.layoutManager.uiGroup || Main.layoutManager.uiGroup.is_destroyed?.())
                return GLib.SOURCE_CONTINUE;
            const island = Main.layoutManager.uiGroup.get_children().find(a => a.name === 'gnomacDynamicIsland');
            const width = island?.width ?? 0;
            if (width !== this._lastNotchWidth) {
                this._lastNotchWidth = width;
                this._queueAvoidNotch();
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._tracker = Shell.WindowTracker.get_default();
        this._focusId = this._tracker.connect('notify::focus-app', () => this._rebuild());
        this._rebuild();
    }

    disable() {
        if (this._notchTimer) {
            GLib.source_remove(this._notchTimer);
            this._notchTimer = 0;
        }
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        if (this._focusId) {
            this._tracker.disconnect(this._focusId);
            this._focusId = 0;
        }
        this._clear();
    }

    _clear() {
        for (const button of this._buttons)
            button.destroy();
        this._buttons = [];
    }

    _rebuild() {
        const app = this._tracker.focus_app;
        // Opening a menu can move focus to the shell; keep the menus of the
        // app that was in front.
        if (!app && this._buttons.length && Main.panel.menuManager.activeMenu)
            return;
        this._clear();
        const menus = standardMenus(app);
        // Right after the app name, like macOS.
        const appName = Main.panel.statusArea['gnomac-appname'];
        let position = appName ? Main.panel._leftBox.get_children().indexOf(appName.container) + 1 : 2;
        menus.forEach((spec, i) => {
            const button = new MenuTitle(spec);
            button.connect('destroy', () => (button._gone = true));
            Main.panel.addToStatusArea(`gnomac-menu-${i}`, button, position++, 'left');
            this._buttons.push(button);
        });
        this._queueAvoidNotch();
    }

    // Like macOS on notched MacBooks: menus that would run under the
    // Dynamic Island are dropped (the last ones first).
    _queueAvoidNotch() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._avoidNotch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _avoidNotch() {
        const monitor = Main.layoutManager.primaryMonitor;
        // Buttons are destroyed on every rebuild; drop the dead ones first.
        this._buttons = this._buttons.filter(b => !b._gone);
        if (!monitor || !this._buttons.length)
            return;
        const island = Main.layoutManager.uiGroup.get_children()
            .find(a => a.name === 'gnomacDynamicIsland' && a.visible);
        // Real width of the folded notch (it widens with media or a timer),
        // never the expanded card: that one only exists while hovered.
        const notchHalf = island ? Math.min(island.width, 240) / 2 : 0;
        const limit = monitor.x + monitor.width / 2 - notchHalf - 6;
        // Freshly added buttons are only measured after the next layout.
        if (this._buttons.some(b => !b.container.has_allocation())) {
            this._queueAvoidNotch();
            return;
        }
        for (const button of this._buttons) {
            const [x] = button.container.get_transformed_position();
            const fits = x + button.container.width <= limit;
            button.container.visible = fits;
        }
    }
}
