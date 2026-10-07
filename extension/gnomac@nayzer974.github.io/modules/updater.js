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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {t} from '../lib/i18n.js';

const REPO = 'Nayzer974/GNOMAC';
const API = `https://api.github.com/repos/${REPO}/commits/main`;
const INSTALLED = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnomac', 'installed.json']);
const FIRST_CHECK_SECONDS = 90;

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
    }

    disable() {
        if (this._extension.updater === this)
            this._extension.updater = null;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
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
            this.check();
            this._schedule(this._settings.get_int('update-hours') * 3600);
            return GLib.SOURCE_REMOVE;
        });
    }

    // `manual`: the user asked, so say the result even when there is nothing new.
    check({manual = false} = {}) {
        const mode = this._settings.get_string('update-mode');
        if (!this._session || (!manual && (mode === 'off' || !this._settings.get_boolean('enable-updater'))))
            return;
        const message = Soup.Message.new('GET', API);
        message.request_headers.append('User-Agent', 'GNOMAC-updater');
        message.request_headers.append('Accept', 'application/vnd.github+json');
        this._session.send_and_read_async(message, GLib.PRIORITY_LOW, null, (session, result) => {
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
                }, manual);
            } catch (e) {
                // Offline or rate-limited: try again at the next check.
                if (manual)
                    Main.notify('GNOMAC', t('Could not check for updates.', 'Impossible de chercher des mises à jour.'));
                console.log(`GNOMAC updater: ${e.message}`);
            }
        });
    }

    _onLatest(latest, manual) {
        this._settings.set_string('update-latest', latest.sha);
        const installed = readInstalled();
        const current = installed?.sha ?? '';
        const newer = latest.sha && current !== latest.sha;
        if (!newer) {
            if (manual)
                Main.notify('GNOMAC', t('GNOMAC is up to date.', 'GNOMAC est à jour.'));
            return;
        }
        const mode = this._settings.get_string('update-mode');
        if (!manual && this._settings.get_string('update-dismissed') === latest.sha)
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
        notification.addAction(t('Update', 'Mettre à jour'), () => this.install(latest, false));
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
        const notification = new MessageTray.Notification({
            source: this._notifySource(),
            title: t('GNOMAC is updated', 'GNOMAC est à jour'),
            body: t('Log out and back in to use the new version.', 'Déconnecte-toi puis reconnecte-toi pour utiliser la nouvelle version.'),
            urgency: MessageTray.Urgency.NORMAL,
        });
        this._source.addNotification(notification);
    }
}
