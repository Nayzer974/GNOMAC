// macOS menu bar menus for the focused app: File, Edit, View, (app extras
// such as Spotify's Playback), Window, Help. Like RevoShell's TopBar, the
// menus are described here rather than read from the app (GTK 4 apps no
// longer export menus); items send the app's real keyboard shortcut or act
// on its window through mutter, and show the shortcut macOS-style.

import Clutter from 'gi://Clutter';
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
        this._tracker = Shell.WindowTracker.get_default();
        this._focusId = this._tracker.connect('notify::focus-app', () => this._rebuild());
        this._rebuild();
    }

    disable() {
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
            Main.panel.addToStatusArea(`gnomac-menu-${i}`, button, position++, 'left');
            this._buttons.push(button);
        });
    }
}
