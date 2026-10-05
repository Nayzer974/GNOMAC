// macOS-style menu bar on top of the stock GNOME panel: system menu on the
// left, bold focused-app name with its menu, clock moved to the far right in
// the macOS format, Activities hidden. Golden Gate's menu bar is transparent
// by default; a Liquid Glass background is optional.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import * as Session from '../lib/session.js';
import {closeAbout, showAbout} from '../lib/about.js';
import {t} from '../lib/i18n.js';

function launch(argv) {
    try {
        Util.spawn(argv);
    } catch (e) {
        logError(e, `GNOMAC: cannot launch ${argv[0]}`);
    }
}

function launchFirst(desktopIds, fallback) {
    const appSystem = Shell.AppSystem.get_default();
    for (const id of desktopIds) {
        const app = appSystem.lookup_app(id);
        if (app) {
            app.activate();
            return;
        }
    }
    if (fallback)
        launch(fallback);
}

// Recently used files, from GTK's shared recent-files list.
function recentFiles(limit = 8) {
    try {
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return [];
        const text = new TextDecoder().decode(bytes);
        return [...text.matchAll(/<bookmark href="([^"]+)"[^>]*modified="([^"]+)"/g)]
            .map(m => ({uri: m[1], modified: m[2]}))
            .filter(e => e.uri.startsWith('file://'))
            .sort((a, b) => b.modified.localeCompare(a.modified))
            .slice(0, limit)
            .map(e => ({uri: e.uri, name: decodeURIComponent(e.uri.split('/').pop())}));
    } catch {
        return [];
    }
}

const SystemMenuButton = GObject.registerClass(
class SystemMenuButton extends PanelMenu.Button {
    _init(extensionPath, logo) {
        super._init(0.0, 'GNOMAC system menu');
        this.add_style_class_name('gnomac-apple-button');
        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extensionPath}/icons/${logo === 'bridge' ? 'gnomac-logo' : 'apple'}.svg`),
            style_class: 'system-status-icon gnomac-logo',
        }));

        // macOS Tahoe menus show a small symbol before each item and the
        // shortcut on the right.
        const add = (icon, label, callback, shortcut = null) => {
            const item = new PopupMenu.PopupImageMenuItem(label, icon);
            if (shortcut) {
                item.add_child(new St.Label({text: shortcut, style_class: 'gnomac-menu-shortcut',
                    x_expand: true, x_align: Clutter.ActorAlign.END}));
            }
            item.connect('activate', callback);
            this.menu.addMenuItem(item);
            return item;
        };
        const separator = () => this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('computer-symbolic', t('About This Mac', 'À propos de ce Mac'), () => showAbout());
        separator();
        add('emblem-system-symbolic', t('System Settings…', 'Réglages Système…'),
            () => launch(['gnome-control-center']));
        add('system-software-install-symbolic', t('App Store…', 'App Store…'),
            () => launchFirst(['org.gnome.Software.desktop', 'io.github.kolunmi.Bazaar.desktop'], ['gnome-software']));
        separator();
        this._recent = new PopupMenu.PopupSubMenuMenuItem(t('Recent Items', 'Éléments récents'), true);
        this._recent.icon.icon_name = 'document-open-recent-symbolic';
        this.menu.addMenuItem(this._recent);
        separator();
        add('process-stop-symbolic', t('Force Quit…', 'Forcer à quitter…'),
            () => launchFirst(['org.gnome.SystemMonitor.desktop', 'io.missioncenter.MissionCenter.desktop'], ['gnome-system-monitor']),
            '⌥⌘⎋');
        separator();
        add('weather-clear-night-symbolic', t('Sleep', 'Suspendre l\'activité'), () => Session.suspend());
        add('system-reboot-symbolic', t('Restart…', 'Redémarrer…'), () => Session.restart());
        add('system-shutdown-symbolic', t('Shut Down…', 'Éteindre…'), () => Session.powerOff());
        separator();
        add('system-lock-screen-symbolic', t('Lock Screen', 'Verrouiller l\'écran'),
            () => Session.lockScreen(), '⌃⌘Q');
        const user = GLib.get_real_name() || GLib.get_user_name();
        add('system-log-out-symbolic', t(`Log Out ${user}…`, `Fermer la session de ${user}…`),
            () => Session.logOut(), '⇧⌘Q');

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._fillRecent();
        });
    }

    _fillRecent() {
        const menu = this._recent.menu;
        menu.removeAll();
        const files = recentFiles();
        if (!files.length) {
            const empty = new PopupMenu.PopupMenuItem(t('No Recent Items', 'Aucun élément récent'));
            empty.sensitive = false;
            menu.addMenuItem(empty);
            return;
        }
        for (const file of files) {
            const item = new PopupMenu.PopupMenuItem(file.name);
            item.connect('activate', () => Gio.AppInfo.launch_default_for_uri(file.uri,
                global.create_app_launch_context(0, -1)));
            menu.addMenuItem(item);
        }
    }
});

const AppNameButton = GObject.registerClass(
class AppNameButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'GNOMAC app menu', true);
        this._label = new St.Label({
            style_class: 'gnomac-appname',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._appMenu = new AppMenu(this, St.Side.TOP, {
            favoritesSection: true,
            showSingleWindows: true,
        });
        this.setMenu(this._appMenu);

        this._tracker = Shell.WindowTracker.get_default();
        this._focusId = this._tracker.connect('notify::focus-app', () => this._sync());
        this._sync();
    }

    _sync() {
        const app = this._tracker.focus_app;
        this._label.text = app ? app.get_name() : t('Desktop', 'Bureau');
        this._appMenu.setApp(app);
        this.reactive = !!app;
    }

    _onDestroy() {
        this._tracker.disconnect(this._focusId);
        super._onDestroy();
    }
});

export class TopBar {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
    }

    enable() {
        const panel = Main.panel;
        panel.add_style_class_name('gnomac-panel');

        this._activities = panel.statusArea.activities;
        this._activities?.container.hide();

        this._systemMenu = new SystemMenuButton(this._extension.path,
            this._settings.get_string('logo-style'));
        panel.addToStatusArea('gnomac-system', this._systemMenu, 0, 'left');
        this._appName = new AppNameButton();
        panel.addToStatusArea('gnomac-appname', this._appName, 1, 'left');

        this._moveClock();

        if (this._settings.get_string('panel-style') === 'glass')
            this._addGlass();
    }

    disable() {
        closeAbout();
        this._removeGlass();
        this._restoreClock();
        this._appName?.destroy();
        this._appName = null;
        this._systemMenu?.destroy();
        this._systemMenu = null;
        this._activities?.container.show();
        this._activities = null;
        Main.panel.remove_style_class_name('gnomac-panel');
    }

    // macOS keeps the clock at the far right: "Sat 3 Oct 22:47".
    _moveClock() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu)
            return;
        this._dateMenu = dateMenu;
        const container = dateMenu.container;
        this._clockParent = container.get_parent();
        this._clockIndex = this._clockParent.get_children().indexOf(container);
        this._clockParent.remove_child(container);
        Main.panel._rightBox.add_child(container);

        const original = dateMenu._clockDisplay;
        this._clock = new St.Label({style_class: 'clock gnomac-clock', y_align: Clutter.ActorAlign.CENTER});
        original.get_parent().insert_child_above(this._clock, original);
        original.hide();
        this._updateClock();
    }

    _updateClock() {
        const now = GLib.DateTime.new_now_local();
        this._clock.text = now.format('%a %-d %b  %H:%M');
        // Re-arm on the next minute boundary.
        const delay = 60 - now.get_second();
        this._clockTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._clockTimeout = 0;
            this._updateClock();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreClock() {
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = 0;
        }
        if (!this._dateMenu)
            return;
        this._clock.destroy();
        this._clock = null;
        this._dateMenu._clockDisplay.show();
        const container = this._dateMenu.container;
        container.get_parent()?.remove_child(container);
        this._clockParent.insert_child_at_index(container, Math.max(0, this._clockIndex));
        this._dateMenu = null;
    }

    _addGlass() {
        const panelBox = Main.layoutManager.panelBox;
        this._glass = new GlassSurface({
            blur: this._settings.get_int('glass-blur'),
            glass: {...glassParamsFromSettings(this._settings, 0), refraction: 0, thickness: 1},
        });
        Main.layoutManager.uiGroup.insert_child_below(this._glass, panelBox);
        Main.panel.add_style_class_name('gnomac-panel-glass');
        const sync = () => {
            this._glass.set_position(panelBox.x, panelBox.y);
            this._glass.set_size(panelBox.width, Main.panel.height);
            this._glass.setStageOrigin(panelBox.x, panelBox.y);
            this._glass.visible = panelBox.visible;
        };
        // Allocation notifications arrive mid-layout: resize on the next frame.
        const syncLater = () => {
            if (this._glassLater)
                return;
            this._glassLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._glassLater = 0;
                sync();
                return GLib.SOURCE_REMOVE;
            });
        };
        this._glassSignals = [
            panelBox.connect('notify::allocation', syncLater),
            panelBox.connect('notify::visible', syncLater),
        ];
        sync();
    }

    _removeGlass() {
        if (!this._glass)
            return;
        if (this._glassLater) {
            global.compositor.get_laters().remove(this._glassLater);
            this._glassLater = 0;
        }
        for (const id of this._glassSignals)
            Main.layoutManager.panelBox.disconnect(id);
        this._glassSignals = [];
        Main.panel.remove_style_class_name('gnomac-panel-glass');
        this._glass.destroy();
        this._glass = null;
    }
}
