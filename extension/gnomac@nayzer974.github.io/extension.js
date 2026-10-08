// GNOMAC — macOS 27 (Golden Gate) feel for GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppMenus} from './modules/appMenus.js';
import {Appearance} from './modules/appearance.js';
import {BootShutdown} from './modules/bootShutdown.js';
import {DesktopIcons} from './modules/desktopIcons.js';
import {Dock} from './modules/dock.js';
import {DynamicIsland} from './modules/dynamicIsland.js';
import {Gaps} from './modules/gaps.js';
import {TrueFullscreen} from './modules/fullscreen.js';
import {GlassDebug} from './modules/glassDebug.js';
import {GlassMenus} from './modules/glassMenus.js';
import {Launchpad} from './modules/launchpad.js';
import {MenuBarIcons} from './modules/menuBarIcons.js';
import {LockScreen} from './modules/lockScreen.js';
import {LoginScreen} from './modules/loginScreen.js';
import {Notifications} from './modules/notifications.js';
import {NotificationCenter} from './modules/notificationCenter.js';
import {Spotlight} from './modules/spotlight.js';
import {StageManager} from './modules/stageManager.js';
import {ThemeCustom} from './modules/themeCustom.js';
import {TopBar} from './modules/topbar.js';
import {Vibrancy} from './modules/vibrancy.js';
import {Updater} from './modules/updater.js';
import {WallpaperPicker} from './modules/wallpaperPicker.js';
import {Widgets} from './modules/widgets.js';
import {WindowAnimations} from './modules/windowAnimations.js';
import {WindowLayout} from './modules/windowLayout.js';
import {closeGuide} from './lib/guide.js';
import {adaptive} from './lib/adaptive.js';
import {glassPerformance} from './lib/glassPerformance.js';
import {displayInfo} from './lib/display.js';
import {destroyTicker} from './lib/spring.js';

// Only modules flagged `locked` run while the screen is locked: the
// extension stays loaded in the unlock-dialog session mode for the lock
// screen, and everything else is stopped until the session is unlocked.
const MODULES = [
    // First, so the boot cover is up before the other modules build the UI.
    {key: 'enable-theme-custom', Module: ThemeCustom},
    {key: 'enable-updater', Module: Updater},
    {key: 'enable-glass-menus', Module: GlassDebug},
    {key: 'enable-boot-shutdown', Module: BootShutdown},
    {key: 'enable-lock-screen', Module: LockScreen, locked: true},
    // GDM's own shell (login screen): the only module that runs there.
    {key: 'enable-login-screen', Module: LoginScreen, greeter: true},
    {key: 'enable-launchpad', Module: Launchpad},
    {key: 'enable-topbar', Module: TopBar},
    {key: 'enable-app-menus', Module: AppMenus},
    {key: 'enable-dock', Module: Dock},
    {key: 'enable-dock', Module: Gaps},
    {key: 'enable-spotlight', Module: Spotlight},
    {key: 'enable-glass-menus', Module: GlassMenus},
    {key: 'enable-window-animations', Module: WindowAnimations},
    {key: 'enable-dynamic-island', Module: DynamicIsland},
    {key: 'enable-notifications', Module: Notifications},
    {key: 'enable-notification-center', Module: NotificationCenter},
    {key: 'enable-vibrancy', Module: Vibrancy},
    {key: 'enable-widgets', Module: Widgets},
    {key: 'enable-desktop-icons', Module: DesktopIcons},
    {key: 'enable-wallpaper-picker', Module: WallpaperPicker},
    {key: 'enable-fullscreen', Module: TrueFullscreen},
    {key: 'enable-menubar-icons', Module: MenuBarIcons},
    {key: 'enable-appearance', Module: Appearance},
    {key: 'enable-window-layout', Module: WindowLayout},
    {key: 'enable-window-layout', Module: StageManager},
];

export default class GnomacExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._modules = [];
        // GNOME opens the overview while it starts the session; macOS lands
        // on the desktop. Animations are only forced after that startup
        // animation: lifting the inhibition in the middle of it left the
        // overview frozen half-way in VMs.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                Main.overview.hide();
                this._forceAnimations();
            });
        }
        this._start();
        // Any change rebuilds the modules; debounce so dragging a slider in
        // the preferences does not rebuild on every step.
        // Runtime state (Pomodoro timings, reminders) is read live by its
        // module: changing it must not rebuild the whole shell UI.
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key.startsWith('pomodoro-') || key.startsWith('theme-') || key.startsWith('update-') || key === 'desktop-icons-layout' || key === 'desktop-icons-visible' || key === 'whatsnew-seen' || key === 'island-shelf' || key === 'glass-inspector' || key === 'glass-debug-groups' || key === 'glass-debug' || key === 'glass-debug-mode' || key === 'widget-reminders' || key === 'widgets-layout')
                return;
            this._scheduleReload();
        });
        this._sessionId = Main.sessionMode.connect('updated', () => this._reload());
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        this._settings.disconnect(this._settingsId);
        Main.sessionMode.disconnect(this._sessionId);
        this._stop();
        adaptive.stop();
        glassPerformance.stop();
        displayInfo.stop();
        closeGuide(true);
        destroyTicker();
        this._settings = null;
    }

    // Whether a module runs in the current session mode. Only modules flagged
    // `locked` run while the screen is locked, and the login module runs alone
    // in GDM's shell.
    _shouldRun({key, locked: allowedLocked, greeter: forGreeter}) {
        const locked = Main.sessionMode.isLocked;
        const greeter = Main.sessionMode.currentMode === 'gdm';
        if (!this._settings.get_boolean(key) || (locked && !allowedLocked))
            return false;
        return greeter === !!forGreeter;
    }

    // `keep`: modules (classes) that are already running and stay as they are.
    _start(keep = new Set()) {
        this._forceAnimations();
        adaptive.start();
        displayInfo.start();
        glassPerformance.refreshHz = () => displayInfo.refreshHz;
        glassPerformance.start(this.getSettings());
        for (const entry of MODULES) {
            const {key, Module} = entry;
            if (keep.has(Module) || !this._shouldRun(entry))
                continue;
            const module = new Module(this);
            try {
                module.enable();
                this._modules.push(module);
            } catch (e) {
                logError(e, `GNOMAC: cannot enable ${key}`);
                try {
                    module.disable();
                } catch {}
            }
        }
    }

    _stop(keep = new Set()) {
        const kept = [];
        for (const module of this._modules.reverse()) {
            if (keep.has(module.constructor)) {
                kept.unshift(module);
                continue;
            }
            try {
                module.disable();
            } catch (e) {
                logError(e, 'GNOMAC: error while disabling a module');
            }
        }
        this._modules = kept;
        this._releaseAnimations();
    }

    // GNOME inhibits animations with software rendering (VMs without 3D).
    // When asked, lift that inhibition — but only if the user's own
    // "enable-animations" preference is on, and only once.
    _forceAnimations() {
        if (this._startupId || this._uninhibited)
            return;
        const st = St.Settings.get();
        const wanted = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_boolean('enable-animations');
        if (this._settings.get_boolean('force-animations') && wanted && !st.enable_animations) {
            st.uninhibit_animations();
            this._uninhibited = true;
        }
    }

    _releaseAnimations() {
        if (this._uninhibited) {
            St.Settings.get().inhibit_animations();
            this._uninhibited = false;
        }
    }

    // Locking and unlocking switch the set of running modules right away. The
    // lock screen module runs in both modes: it stays, so a lock or an unlock
    // only builds or removes what changes (the rebuild at unlock was the pause
    // in the transition) and the lock screen's own state is not torn down.
    _reload() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        const keep = new Set();
        for (const entry of MODULES) {
            if (entry.locked && this._shouldRun(entry) && this._modules.some(m => m.constructor === entry.Module))
                keep.add(entry.Module);
        }
        this._stop(keep);
        this._start(keep);
    }

    _scheduleReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._reloadId = 0;
            this._stop();
            this._start();
            return GLib.SOURCE_REMOVE;
        });
    }
}
