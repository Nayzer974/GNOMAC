// Install (or check) GNOMAC's login screen from inside the desktop:
// Spotlight > "Install the Login Screen". The part that needs administrator
// rights runs through pkexec: the system's own password dialog appears; GNOMAC
// never sees, asks for or stores the password.
//
// The login screen is GDM's own shell, a different program from your desktop:
// it only changes after gdm/install-gdm.sh has copied the extension to GDM and
// told GDM to load it. Until then it stays GNOME's (this is why the login
// screen can look like GNOME on a real machine while a VM, where the script
// was run, looks like GNOMAC).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {readInstalled} from '../modules/updater.js';
import {t} from './i18n.js';

function sourceDir() {
    const candidates = [readInstalled()?.source, GLib.build_filenamev([GLib.get_user_data_dir(), 'gnomac-src'])];
    return candidates.find(dir => dir && GLib.file_test(GLib.build_filenamev([dir, 'gdm', 'install-gdm.sh']), GLib.FileTest.EXISTS)) ?? null;
}

function run(argv, onDone) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                onDone(p.get_successful(), out ?? '');
            } catch (e) {
                onDone(false, e.message);
            }
        });
    } catch (e) {
        onDone(false, e.message);
    }
}

// Makes sure a full copy of GNOMAC is on disk (the script needs the gdm/ folder).
function ensureSource(then) {
    const dir = sourceDir();
    if (dir) {
        then(dir);
        return;
    }
    Main.notify('GNOMAC', t('Downloading GNOMAC first…', 'Téléchargement de GNOMAC d’abord…'));
    run(['bash', '-c', 'curl -fsSL https://raw.githubusercontent.com/Nayzer974/GNOMAC/main/get.sh | bash'], (ok, out) => {
        const downloaded = sourceDir();
        if (!downloaded) {
            Main.notify('GNOMAC', t('Download failed: ', 'Téléchargement impossible : ') + out.split('\n').slice(-2).join(' '));
            return;
        }
        then(downloaded);
    });
}

export function installLoginScreen(autoSync = false) {
    ensureSource(dir => {
        const script = GLib.build_filenamev([dir, 'gdm', 'install-gdm.sh']);
        Main.notify('GNOMAC', t('The system asks for your password to install the login screen.',
            'Le système demande ton mot de passe pour installer l’écran de connexion.'));
        run(['pkexec', 'env', `SUDO_USER=${GLib.get_user_name()}`, 'bash', script, ...(autoSync ? ['--auto-sync'] : [])], (ok, out) => {
            Main.notify('GNOMAC', ok
                ? t('Login screen installed. It appears at the next login screen (log out to see it).',
                    'Écran de connexion installé. Il apparaît au prochain écran de connexion (déconnecte-toi pour le voir).')
                : t('Installation failed or was cancelled: ', 'Installation échouée ou annulée : ') + out.split('\n').slice(-3).join(' '));
        });
    });
}

// What is installed, without changing anything (no administrator rights needed).
export function checkLoginScreen() {
    ensureSource(dir => {
        const script = GLib.build_filenamev([dir, 'gdm', 'install-gdm.sh']);
        run(['bash', script, '--check'], (_ok, out) => {
            const text = out.replace(/\u001b\[[0-9;]*m/g, '').trim();
            try {
                const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac']);
                GLib.mkdir_with_parents(cache, 0o755);
                GLib.file_set_contents(GLib.build_filenamev([cache, 'login-screen-check.txt']), text);
            } catch {}
            Main.notify('GNOMAC', `${t('Login screen check (saved in ~/.cache/gnomac/login-screen-check.txt):', 'Vérification de l’écran de connexion (copiée dans ~/.cache/gnomac/login-screen-check.txt) :')}\n${text.split('\n').slice(0, 8).join('\n')}`);
        });
    });
}
