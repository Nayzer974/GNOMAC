// macOS-style menu bar on top of the stock GNOME panel: system menu on the
// left, bold focused-app name with its menu, clock moved to the far right in
// the macOS format, Activities hidden. Golden Gate's menu bar is transparent
// by default; a Liquid Glass background is optional.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
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

const SystemMenuButton = GObject.registerClass(
class SystemMenuButton extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.0, 'GNOMAC system menu');
        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extensionPath}/icons/gnomac-logo.svg`),
            style_class: 'system-status-icon gnomac-logo',
        }));

        const actions = SystemActions.getDefault();
        const add = (label, callback) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', callback);
            this.menu.addMenuItem(item);
        };
        const separator = () => this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add(t('About This Computer', 'À propos de cet ordinateur'),
            () => launch(['gnome-control-center', 'system']));
        separator();
        add(t('System Settings…', 'Réglages Système…'),
            () => launch(['gnome-control-center']));
        add(t('App Store…', 'App Store…'),
            () => launchFirst(['org.gnome.Software.desktop', 'io.github.kolunmi.Bazaar.desktop'], ['gnome-software']));
        separator();
        add(t('Force Quit…', 'Forcer à quitter…'),
            () => launchFirst(['org.gnome.SystemMonitor.desktop', 'io.missioncenter.MissionCenter.desktop'], ['gnome-system-monitor']));
        separator();
        add(t('Sleep', 'Suspendre l\'activité'), () => actions.activateSuspend());
        add(t('Restart…', 'Redémarrer…'), () => actions.activateRestart());
        add(t('Shut Down…', 'Éteindre…'), () => actions.activatePowerOff());
        separator();
        add(t('Lock Screen', 'Verrouiller l\'écran'), () => actions.activateLockScreen());
        add(t('Log Out…', 'Fermer la session…'), () => actions.activateLogout());
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

        this._systemMenu = new SystemMenuButton(this._extension.path);
        panel.addToStatusArea('gnomac-system', this._systemMenu, 0, 'left');
        this._appName = new AppNameButton();
        panel.addToStatusArea('gnomac-appname', this._appName, 1, 'left');

        this._moveClock();

        if (this._settings.get_string('panel-style') === 'glass')
            this._addGlass();
    }

    disable() {
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
        this._glassSignals = [
            panelBox.connect('notify::allocation', sync),
            panelBox.connect('notify::visible', sync),
        ];
        sync();
    }

    _removeGlass() {
        if (!this._glass)
            return;
        for (const id of this._glassSignals)
            Main.layoutManager.panelBox.disconnect(id);
        this._glassSignals = [];
        Main.panel.remove_style_class_name('gnomac-panel-glass');
        this._glass.destroy();
        this._glass = null;
    }
}
