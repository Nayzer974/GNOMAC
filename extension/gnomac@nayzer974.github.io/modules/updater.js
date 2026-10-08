// Updates, from GitHub: every few hours (and shortly after login) the latest
// commit on main is compared with the one this machine was installed from.
// A newer one gives a notification, "GNOMAC: new update available", with
// Update / Later / What's new. In "auto" mode it is installed in the
// background and you are told to log in again. "off" does nothing.
//
// The update itself is scripts/update.sh in your GNOMAC source folder: it pulls
// (or downloads) the new version and runs install.sh --update (no sudo, your
// settings and user.css untouched). Wayland cannot reload the shell, so the new
// code runs after the next login; the notification says so.
//
// Only https://api.github.com/repos/Nayzer974/GNOMAC is ever contacted for the
// check, and the same repository is what update.sh installs from.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {t} from '../lib/i18n.js';
import {Easing} from '../lib/motionTokens.js';
import {timelines} from '../lib/animationTimeline.js';

const REPO = 'Nayzer974/GNOMAC';
const API = `https://api.github.com/repos/${REPO}/commits/main`;
const INSTALLED = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnomac', 'installed.json']);
// The check runs at every start of the session (the network may not be up yet,
// so a failed first try is repeated), then every `update-hours` hours.
const FIRST_CHECK_SECONDS = 20;
const RETRY_SECONDS = [30, 60, 120, 240];

export function readInstalled() {
    try {
        const [ok, bytes] = GLib.file_get_contents(INSTALLED);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    } catch {
        return null;
    }
}

export class Updater {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._session = null;
    }

    enable() {
        this._extension.updater = this;
        this._session = new Soup.Session({timeout: 12});
        this._schedule(FIRST_CHECK_SECONDS);
        this._addButton();
        // Once the desktop has settled: after an update, say what is new.
        this._whatsNewId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 8, () => {
            this._whatsNewId = 0;
            this.showWhatsNew(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    // A button in the menu bar: check for an update by hand. A dot says that
    // one is waiting. A click checks; the answer comes as a notification.
    _addButton() {
        if (!this._settings.get_boolean('update-button'))
            return;
        const content = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._icon = new St.Icon({icon_name: 'software-update-available-symbolic', icon_size: 15,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._icon.set_pivot_point(0.5, 0.5);
        this._dot = new St.Widget({style_class: 'gnomac-bell-dot', visible: false, reactive: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        content.add_child(this._icon);
        content.add_child(this._dot);
        this._button = new St.Button({style_class: 'panel-button gnomac-update-button', can_focus: false, reactive: true,
            y_align: Clutter.ActorAlign.CENTER, child: content, accessible_name: t('Check for updates', 'Chercher une mise à jour')});
        // With an update waiting (the dot), a click installs it; otherwise it checks.
        this._button.connect('clicked', () => {
            if (this._latest && this._dot?.visible)
                this.install(this._latest, false);
            else
                this.check({manual: true});
        });
        this._button.connect('destroy', () => (this._button = null));
        const right = Main.panel._rightBox;
        const anchor = Main.panel.statusArea.quickSettings?.container ?? null;
        if (anchor && anchor.get_parent() === right)
            right.insert_child_below(this._button, anchor);
        else
            right.add_child(this._button);
        this._syncDot();
    }

    _syncDot() {
        if (!this._dot)
            return;
        const latest = this._settings.get_string('update-latest');
        const current = readInstalled()?.sha ?? '';
        this._dot.visible = !!latest && latest !== current;
    }

    // The icon turns while GitHub is being asked.
    _spin(on) {
        if (!this._icon)
            return;
        this._spinRun?.cancel();
        this._spinRun = null;
        if (!on) {
            this._icon.rotation_angle_z = 0;
            return;
        }
        this._spinRun = timelines.run({
            duration: 900, easing: Easing.linear,
            onFrame: (_e, raw) => (this._icon.rotation_angle_z = 360 * raw),
            onDone: () => {
                this._icon.rotation_angle_z = 0;
                if (this._checking)
                    this._spin(true);
            },
        });
    }

    // After an update: the notes of the releases not seen yet. `force` (from
    // Spotlight) shows the latest ones even if they were seen.
    showWhatsNew(force) {
        import('../lib/whatsNew.js').then(m => {
            const releases = m.loadReleases(this._extension);
            const list = force ? releases.slice(0, 3) : m.releasesToShow(releases, this._settings.get_int('whatsnew-seen'));
            if (list.length)
                m.showWhatsNew(this._extension, list);
        }).catch(e => logError(e, 'GNOMAC updater: what is new'));
    }

    disable() {
        if (this._extension.updater === this)
            this._extension.updater = null;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._whatsNewId) {
            GLib.source_remove(this._whatsNewId);
            this._whatsNewId = 0;
        }
        this._spinRun?.cancel();
        this._button?.destroy();
        this._button = null;
        import('../lib/whatsNew.js').then(m => m.closeWhatsNew()).catch(() => {});
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        this._session?.abort();
        this._session = null;
        this._source?.destroy();
        this._source = null;
    }

    _schedule(seconds) {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._timeoutId = 0;
            const startup = !this._started;
            this._started = true;
            this.check({startup});
            this._schedule(this._settings.get_int('update-hours') * 3600);
            return GLib.SOURCE_REMOVE;
        });
    }

    // `manual`: the user asked, so say the result even when there is nothing new.
    // `startup`: the check of a new session; a version the user already said "later" to is announced again.
    check({manual = false, startup = false, attempt = 0} = {}) {
        const mode = this._settings.get_string('update-mode');
        if (!this._session || (!manual && (mode === 'off' || !this._settings.get_boolean('enable-updater'))))
            return;
        this._checking = true;
        if (manual)
            this._spin(true);
        const message = Soup.Message.new('GET', API);
        message.request_headers.append('User-Agent', 'GNOMAC-updater');
        message.request_headers.append('Accept', 'application/vnd.github+json');
        this._session.send_and_read_async(message, GLib.PRIORITY_LOW, null, (session, result) => {
            this._checking = false;
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK)
                    throw new Error(`GitHub answered ${message.get_status()}`);
                const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                this._onLatest({
                    sha: json.sha,
                    message: (json.commit?.message ?? '').split('\n')[0],
                    url: json.html_url,
                    date: json.commit?.committer?.date ?? '',
                }, manual, startup);
            } catch (e) {
                // Offline (the network is often not up yet at login) or
                // rate-limited: try again soon, a few times, then at the next check.
                if (!manual && startup && attempt < RETRY_SECONDS.length && this._session) {
                    this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RETRY_SECONDS[attempt], () => {
                        this._retryId = 0;
                        this.check({startup, attempt: attempt + 1});
                        return GLib.SOURCE_REMOVE;
                    });
                }
                if (manual)
                    Main.notify('GNOMAC', t('Could not check for updates.', 'Impossible de chercher des mises à jour.'));
                console.log(`GNOMAC updater: ${e.message}`);
            }
        });
    }

    _onLatest(latest, manual, startup = false) {
        this._latest = latest;
        this._settings.set_string('update-latest', latest.sha);
        this._syncDot();
        const installed = readInstalled();
        const current = installed?.sha ?? '';
        const newer = latest.sha && current !== latest.sha;
        if (!newer) {
            if (manual)
                Main.notify('GNOMAC', t('GNOMAC is up to date.', 'GNOMAC est à jour.'));
            return;
        }
        const mode = this._settings.get_string('update-mode');
        if (!manual && !startup && this._settings.get_string('update-dismissed') === latest.sha)
            return;
        if (mode === 'auto' && !manual)
            this.install(latest, true);
        else
            this._notifyAvailable(latest);
    }

    _notifySource() {
        if (this._source)
            return this._source;
        this._source = new MessageTray.Source({title: 'GNOMAC', iconName: 'software-update-available-symbolic'});
        this._source.connect('destroy', () => (this._source = null));
        Main.messageTray.add(this._source);
        return this._source;
    }

    _notifyAvailable(latest) {
        const notification = new MessageTray.Notification({
            source: this._notifySource(),
            title: t('New update available', 'Nouvelle mise à jour disponible'),
            body: latest.message || t('A new version of GNOMAC is ready.', 'Une nouvelle version de GNOMAC est prête.'),
            urgency: MessageTray.Urgency.NORMAL,
        });
        // The button, and a click on the banner itself, both install.
        notification.addAction(t('Update', 'Mettre à jour'), () => this.install(latest, false));
        notification.connect('activated', () => this.install(latest, false));
        notification.addAction(t('Later', 'Plus tard'), () =>
            this._settings.set_string('update-dismissed', latest.sha));
        if (latest.url) {
            notification.addAction(t('What’s new', 'Nouveautés'), () =>
                Gio.AppInfo.launch_default_for_uri(latest.url, global.create_app_launch_context(0, -1)));
        }
        this._source.addNotification(notification);
    }

    // Runs scripts/update.sh from the source folder recorded at install time.
    install(latest, automatic) {
        console.log(`GNOMAC updater: install requested (${automatic ? 'automatic' : 'by you'})`);
        const installed = readInstalled();
        let script = installed?.source ? GLib.build_filenamev([installed.source, 'scripts', 'update.sh']) : '';
        if (!script || !GLib.file_test(script, GLib.FileTest.EXISTS))
            script = GLib.build_filenamev([this._extension.path, '..', '..', '..', 'gnomac-src', 'scripts', 'update.sh']);
        if (!GLib.file_test(script, GLib.FileTest.EXISTS)) {
            script = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnomac-src', 'scripts', 'update.sh']);
        }
        if (!automatic)
            Main.notify('GNOMAC', t('Updating…', 'Mise à jour en cours…'));
        try {
            // No source folder (it was a temporary copy that is gone): the
            // updater script is fetched from GitHub and downloads the source itself.
            const argv = GLib.file_test(script, GLib.FileTest.EXISTS)
                ? ['bash', script]
                : ['bash', '-c', 'curl -fsSL https://raw.githubusercontent.com/Nayzer974/GNOMAC/main/scripts/update.sh | bash'];
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            proc.wait_check_async(null, (p, res) => {
                try {
                    p.wait_check_finish(res);
                    this._settings.set_string('update-dismissed', '');
                    this._notifyDone();
                } catch (e) {
                    Main.notify('GNOMAC', t('The update failed: see ~/.config/gnomac/update.log',
                        'La mise à jour a échoué : voir ~/.config/gnomac/update.log'));
                }
            });
        } catch (e) {
            logError(e, 'GNOMAC updater');
        }
    }

    _notifyDone() {
        this._syncDot();
        const notification = new MessageTray.Notification({
            source: this._notifySource(),
            title: t('GNOMAC is updated', 'GNOMAC est à jour'),
            body: t('Log out and back in to use the new version.', 'Déconnecte-toi puis reconnecte-toi pour utiliser la nouvelle version.'),
            urgency: MessageTray.Urgency.NORMAL,
        });
        this._source.addNotification(notification);
    }
}
