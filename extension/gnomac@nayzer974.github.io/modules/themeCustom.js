// Theme customisation, live.
//
// Two extra stylesheets are loaded after the extension's own, so they win:
//   1. ~/.config/gnomac/generated.css, written from the "Thème" settings
//      (accent colour, corner style, text scale, font, shadows, density…),
//   2. ~/.config/gnomac/user.css, YOURS: edit it with any text editor and the
//      change shows at once, no reload and no log-out. A commented starter
//      (templates/user.css) is copied there the first time.
// docs/THEMING.md lists every class name you can restyle.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnomac']);
const GENERATED = GLib.build_filenamev([CONFIG_DIR, 'generated.css']);
const USER_CSS = GLib.build_filenamev([CONFIG_DIR, 'user.css']);

// St sorts rules of equal weight in no reliable order, so a rule of yours could
// lose to GNOMAC's own. Every declaration of the two files is therefore loaded
// as !important: what you write always wins, whatever the selector.
export function important(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{([^{}]*)\}/g, (_m, body) => {
        const declarations = body.split(';').map(d => d.trim()).filter(Boolean)
            .map(d => (/!important/.test(d) ? d : `${d} !important`));
        return `{ ${declarations.join('; ')}${declarations.length ? ';' : ''} }`;
    });
}

const CORNERS = {
    square: {card: 8, small: 4, pill: 6},
    round: {card: 22, small: 12, pill: 999},
    rounder: {card: 32, small: 18, pill: 999},
};

const SHADOWS = {
    none: 'none',
    soft: '0 10px 30px rgba(0, 0, 0, 0.35)',
    strong: '0 20px 60px rgba(0, 0, 0, 0.6)',
};

const hex = value => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0a84ff');

function rgba(color, alpha) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildCss(settings) {
    const accent = hex(settings.get_string('theme-accent'));
    const corner = CORNERS[settings.get_string('theme-corners')] ?? CORNERS.round;
    const scale = settings.get_double('theme-text-scale');
    const font = settings.get_string('theme-font').trim().replace(/[;{}"']/g, '');
    const shadow = SHADOWS[settings.get_string('theme-shadow')] ?? SHADOWS.soft;
    const density = settings.get_double('theme-density');
    const pt = n => `${(n * scale).toFixed(2)}pt`;
    const px = n => `${Math.round(n * density)}px`;

    const css = [];
    css.push('/* GNOMAC: generated from the Theme settings. Do not edit: use user.css. */');

    // Accent colour, everywhere GNOMAC uses its blue.
    css.push(`.gnomac-guide-heading { color: ${accent}; }`);
    css.push(`.gnomac-about2-bar-used { background-color: ${accent}; }`);
    css.push(`.gnomac-layout-region { background-color: ${rgba(accent, 0.92)}; }`);
    css.push(`.gnomac-seg-item:checked, .gnomac-about2-tab:checked { background-color: ${rgba(accent, 0.55)}; }`);
    css.push(`.gnomac-swatch:checked { border-color: ${accent}; }`);
    css.push(`.gnomac-gallery-plus { color: ${accent}; }`);
    css.push(`.gnomac-notch-tab:checked { background-color: ${rgba(accent, 0.5)}; }`);

    // Corners.
    css.push(`.gnomac-guide, .gnomac-layout-panel, .gnomac-gallery, .gnomac-about { border-radius: ${corner.card}px; }`);
    css.push(`.gnomac-layout-button, .gnomac-gallery-row, .gnomac-stage-card, .gnomac-about-button, ` +
        `.gnomac-dock-tooltip, .gnomac-seg, .gnomac-chip { border-radius: ${corner.small}px; }`);
    css.push(`.gnomac-seg-item, .gnomac-about2-tab { border-radius: ${Math.max(4, corner.small - 2)}px; }`);

    // Shadows of the floating panels.
    css.push(`.gnomac-guide, .gnomac-layout-panel, .gnomac-stage-card { box-shadow: ${shadow}; }`);

    // Text size and family of the interface.
    if (scale !== 1) {
        css.push(`#panel.gnomac-panel { font-size: ${pt(10.5)}; }`);
        css.push(`.gnomac-guide-text, .gnomac-guide-keys, .gnomac-about2-value, .gnomac-about2-key { font-size: ${pt(10.5)}; }`);
        css.push(`.gnomac-dock-tooltip { font-size: ${pt(10.5)}; }`);
    }
    if (font) {
        css.push(`#panel.gnomac-panel, .gnomac-guide, .gnomac-about2-box, .gnomac-dock-tooltip, ` +
            `.gnomac-layout-panel, .gnomac-gallery, .gnomac-notch-dashboard { font-family: "${font}"; }`);
    }

    // Density of lists.
    css.push(`.gnomac-guide-row, .gnomac-about2-row { padding-top: ${px(5)}; padding-bottom: ${px(5)}; }`);
    css.push(`.gnomac-gallery-item { padding-top: ${px(8)}; padding-bottom: ${px(8)}; }`);
    return `${css.join('\n')}\n`;
}

export class ThemeCustom {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._loaded = new Map(); // path -> Gio.File
        this._monitors = [];
    }

    enable() {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        this._seedUserCss();
        this._apply();
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key.startsWith('theme-'))
                this._apply();
        });
        // Editing user.css shows at once.
        const file = Gio.File.new_for_path(USER_CSS);
        try {
            const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._userId = monitor.connect('changed', () => this._queueReload());
            this._monitors.push(monitor);
        } catch (e) {
            logError(e, 'GNOMAC theme: cannot watch user.css');
        }
        // Belt and braces: some editors replace the file in a way the monitor
        // misses, so its modification time is also checked every two seconds.
        this._mtime = this._userMtime();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            const now = this._userMtime();
            if (now !== this._mtime) {
                this._mtime = now;
                this._apply();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _userMtime() {
        try {
            const info = Gio.File.new_for_path(USER_CSS).query_info('time::modified,time::modified-usec,standard::size',
                Gio.FileQueryInfoFlags.NONE, null);
            return `${info.get_attribute_uint64('time::modified')}.${info.get_attribute_uint32('time::modified-usec')}.${info.get_size()}`;
        } catch {
            return '';
        }
    }

    disable() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];
        this._unloadAll();
    }

    // The first time, hand over a commented starter file.
    _seedUserCss() {
        if (GLib.file_test(USER_CSS, GLib.FileTest.EXISTS))
            return;
        const template = GLib.build_filenamev([this._extension.path, 'templates', 'user.css']);
        try {
            Gio.File.new_for_path(template).copy(Gio.File.new_for_path(USER_CSS), Gio.FileCopyFlags.NONE, null, null);
        } catch (e) {
            logError(e, 'GNOMAC theme: cannot create user.css');
        }
    }

    _queueReload() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._timeoutId = 0;
            this._mtime = this._userMtime();
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _theme() {
        return St.ThemeContext.get_for_stage(global.stage).get_theme();
    }

    _unloadAll() {
        const theme = this._theme();
        for (const file of this._loaded.values()) {
            try {
                theme.unload_stylesheet(file);
            } catch {}
        }
        this._loaded.clear();
    }

    _apply() {
        this._unloadAll();
        const theme = this._theme();
        try {
            GLib.file_set_contents(GENERATED, buildCss(this._settings));
        } catch (e) {
            logError(e, 'GNOMAC theme: cannot write generated.css');
        }
        // ONE stylesheet: generated rules first, yours after. Rules of equal
        // weight are only ordered reliably inside a single sheet, so merging
        // is what makes "the last one wins" true.
        let combined = '';
        for (const path of [GENERATED, USER_CSS]) {
            try {
                const [ok, bytes] = GLib.file_get_contents(path);
                if (ok)
                    combined += `${new TextDecoder().decode(bytes)}
`;
            } catch {
                // user.css may not exist yet.
            }
        }
        const processed = GLib.build_filenamev([CONFIG_DIR, '.theme.loaded.css']);
        try {
            GLib.file_set_contents(processed, important(combined));
            const file = Gio.File.new_for_path(processed);
            theme.load_stylesheet(file);
            this._loaded.set(processed, file);
        } catch (e) {
            // A typo in user.css must never break the shell: say so, fall back
            // to the generated rules alone.
            logError(e, 'GNOMAC theme: user.css was not loaded (check its syntax)');
            try {
                Main.notify('GNOMAC', 'user.css : erreur de syntaxe, fichier ignoré');
                const fallback = GLib.build_filenamev([CONFIG_DIR, '.theme.fallback.css']);
                GLib.file_set_contents(fallback, important(buildCss(this._settings)));
                const file = Gio.File.new_for_path(fallback);
                theme.load_stylesheet(file);
                this._loaded.set(fallback, file);
            } catch {}
        }
        // Restyle what is already on screen.
        St.ThemeContext.get_for_stage(global.stage).set_theme(theme);
    }
}
