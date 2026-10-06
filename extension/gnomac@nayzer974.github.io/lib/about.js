// "About This Mac", after macOS 26/27: a glass card with a drawn machine, its
// model and name, three tabs (Overview, Displays, Storage) and the buttons
// More Info… (GNOME's own About page: a different place from System
// Settings), Software Update… and Report a Bug…
//
// Everything is read from the machine: DMI for the model and serial number,
// /proc for the processor, memory and uptime, the file system for storage,
// the monitors for displays, and `lspci` (when installed) for the graphics.

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface} from './glass.js';
import {press} from './motion.js';
import {t} from './i18n.js';

function read(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : '';
    } catch {
        return '';
    }
}

const gb = bytes => {
    const v = bytes / 1e9;
    return v >= 1000 ? `${(v / 1000).toFixed(2).replace(/\.?0+$/, '')} ${t('TB', 'To')}` : `${Math.round(v)} ${t('GB', 'Go')}`;
};

function uptimeText() {
    const seconds = Math.floor(Number(read('/proc/uptime').split(' ')[0]) || 0);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d)
        return `${d} ${t(d > 1 ? 'days' : 'day', d > 1 ? 'jours' : 'jour')} ${h} h`;
    return h ? `${h} h ${m} min` : `${m} min`;
}

function storageInfo() {
    try {
        const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
        const size = info.get_attribute_uint64('filesystem::size');
        const free = info.get_attribute_uint64('filesystem::free');
        return {size, free, used: Math.max(0, size - free)};
    } catch {
        return {size: 0, free: 0, used: 0};
    }
}

function machineInfo() {
    const product = read('/sys/class/dmi/id/product_name');
    const vendor = read('/sys/class/dmi/id/sys_vendor');
    const serial = read('/sys/class/dmi/id/product_serial') || read('/etc/machine-id').slice(0, 12).toUpperCase();
    const cpuInfo = read('/proc/cpuinfo');
    const cpu = (cpuInfo.match(/model name\s*:\s*(.+)/) ?? [])[1] ?? '';
    const cores = (cpuInfo.match(/^processor\s*:/gm) ?? []).length;
    const memKb = Number((read('/proc/meminfo').match(/MemTotal:\s*(\d+)/) ?? [])[1] ?? 0);
    const os = (read('/etc/os-release').match(/PRETTY_NAME="?([^"\n]+)/) ?? [])[1] ?? 'Linux';
    const chassis = Number(read('/sys/class/dmi/id/chassis_type'));
    const laptop = [8, 9, 10, 14, 31, 32].includes(chassis);
    const battery = read('/sys/class/power_supply/BAT0/capacity') || read('/sys/class/power_supply/BAT1/capacity');
    return {
        model: [vendor, product].filter(Boolean).join(' ') || GLib.get_host_name(),
        name: GLib.get_host_name(),
        kind: laptop ? t('Laptop', 'Ordinateur portable') : t('Desktop', 'Ordinateur de bureau'),
        laptop,
        cpu: cpu.replace(/\s+/g, ' ').replace(/\(R\)|\(TM\)/g, '').replace(/ with .*$/, ''),
        cores,
        memory: memKb ? `${Math.round(memKb / 1024 / 1024)} ${t('GB', 'Go')}` : '',
        serial,
        os,
        kernel: read('/proc/sys/kernel/osrelease'),
        shell: `GNOME ${Config.PACKAGE_VERSION}`,
        battery,
    };
}

// The graphics card, when lspci is installed (filled in later).
function graphics(callback) {
    try {
        const proc = Gio.Subprocess.new(['lspci'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                const line = out.split('\n').find(l => /VGA compatible|3D controller|Display controller/.test(l));
                callback(line ? line.replace(/^.*?(VGA compatible controller|3D controller|Display controller):\s*/, '')
                    .replace(/\(rev [0-9a-f]+\)/, '').trim() : '');
            } catch {
                callback('');
            }
        });
    } catch {
        callback('');
    }
}

// A little drawing of the machine, on a wallpaper-coloured screen.
function drawMachine(area, laptop) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const rounded = (x, y, rw, rh, r) => {
        cr.newSubPath();
        cr.arc(x + rw - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + rw - r, y + rh - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + rh - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
    };
    const screen = (x, y, sw, sh) => {
        rounded(x, y, sw, sh, 9);
        cr.setSourceRGB(0.06, 0.06, 0.08);
        cr.fill();
        const inner = 4;
        rounded(x + inner, y + inner, sw - 2 * inner, sh - 2 * inner, 6);
        const g = new Cairo.LinearGradient(x, y, x + sw, y + sh);
        g.addColorStopRGB(0, 0.20, 0.17, 0.42);
        g.addColorStopRGB(0.55, 0.12, 0.13, 0.30);
        g.addColorStopRGB(1, 0.32, 0.42, 0.70);
        cr.setSource(g);
        cr.fill();
        // A soft highlight across the glass.
        rounded(x + inner, y + inner, sw - 2 * inner, sh - 2 * inner, 6);
        cr.clip();
        const hl = new Cairo.LinearGradient(x, y, x + sw * 0.5, y + sh);
        hl.addColorStopRGBA(0, 1, 1, 1, 0.16);
        hl.addColorStopRGBA(0.5, 1, 1, 1, 0);
        cr.setSource(hl);
        cr.paint();
        cr.resetClip();
    };
    if (laptop) {
        const sw = w * 0.66;
        const sh = h * 0.62;
        screen((w - sw) / 2, h * 0.08, sw, sh);
        // The base.
        const bx = (w - sw * 1.18) / 2;
        const by = h * 0.08 + sh + 2;
        rounded(bx, by, sw * 1.18, h * 0.07, 3);
        const g = new Cairo.LinearGradient(0, by, 0, by + h * 0.07);
        g.addColorStopRGB(0, 0.80, 0.81, 0.85);
        g.addColorStopRGB(1, 0.58, 0.60, 0.66);
        cr.setSource(g);
        cr.fill();
    } else {
        const sw = w * 0.62;
        const sh = h * 0.56;
        screen((w - sw) / 2, h * 0.06, sw, sh);
        // The stand.
        cr.moveTo(w / 2 - 7, h * 0.06 + sh);
        cr.lineTo(w / 2 + 7, h * 0.06 + sh);
        cr.lineTo(w / 2 + 11, h * 0.84);
        cr.lineTo(w / 2 - 11, h * 0.84);
        cr.closePath();
        cr.setSourceRGB(0.70, 0.72, 0.78);
        cr.fill();
        rounded(w / 2 - 30, h * 0.84, 60, h * 0.05, 3);
        cr.setSourceRGB(0.78, 0.80, 0.85);
        cr.fill();
    }
    cr.$dispose();
}

let current = null;

export function showAbout() {
    if (current) {
        current.close();
        return;
    }
    const info = machineInfo();
    const monitor = Main.layoutManager.primaryMonitor;
    const width = 440;
    const height = 668;
    const x = Math.round(monitor.x + (monitor.width - width) / 2);
    const y = Math.round(monitor.y + (monitor.height - height) / 2 - 24);

    const root = new St.Widget({reactive: true, x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height});
    const card = new St.Widget({x: x - monitor.x, y: y - monitor.y, width, height,
        style_class: 'gnomac-about', reactive: true});
    const glass = new GlassSurface({backdrop: 'windows', blur: 60,
        glass: {radius: 26, refraction: 10, thickness: 20, chroma: 1.0, rim: 0.55,
            tint: [0.07, 0.07, 0.09, 0.5], depthShade: 0.12}});
    glass.set_size(width, height);
    card.add_child(glass);

    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gnomac-about2-box', width, height});

    // ------------------------------------------------------------ header
    const art = new St.DrawingArea({width: 220, height: 150, x_align: Clutter.ActorAlign.CENTER});
    art.connect('repaint', area => drawMachine(area, info.laptop));
    box.add_child(art);
    box.add_child(new St.Label({text: info.model, style_class: 'gnomac-about2-model',
        x_align: Clutter.ActorAlign.CENTER}));
    box.add_child(new St.Label({text: `${info.kind} · ${info.name}`, style_class: 'gnomac-about2-kind',
        x_align: Clutter.ActorAlign.CENTER}));

    // -------------------------------------------------------------- tabs
    const tabs = new St.BoxLayout({style_class: 'gnomac-about2-tabs', x_align: Clutter.ActorAlign.CENTER});
    const pages = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
    const tabButtons = [];
    const makeTab = (id, label, build) => {
        const page = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'gnomac-about2-page', visible: false});
        build(page);
        pages.add_child(page);
        const button = new St.Button({label, style_class: 'gnomac-about2-tab', toggle_mode: true, can_focus: false});
        press(button, {down: 0.95});
        button.connect('clicked', () => select(id));
        tabs.add_child(button);
        tabButtons.push({id, page, button});
    };
    const select = id => {
        for (const entry of tabButtons) {
            entry.button.checked = entry.id === id;
            if (entry.page.visible !== (entry.id === id)) {
                entry.page.visible = entry.id === id;
                if (entry.id === id) {
                    entry.page.opacity = 0;
                    entry.page.ease({opacity: 255, duration: 200});
                }
            }
        }
    };
    const row = (parent, key, value) => {
        if (!value)
            return null;
        const r = new St.BoxLayout({style_class: 'gnomac-about2-row'});
        r.add_child(new St.Label({text: key, style_class: 'gnomac-about2-key', y_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text: value, style_class: 'gnomac-about2-value', x_expand: true,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.line_wrap = true;
        r.add_child(label);
        parent.add_child(r);
        return label;
    };

    let graphicsLabel = null;
    makeTab('overview', t('Overview', 'Aperçu'), page => {
        row(page, t('Chip', 'Puce'), info.cpu + (info.cores ? ` · ${info.cores} ${t('cores', 'cœurs')}` : ''));
        row(page, t('Memory', 'Mémoire'), info.memory);
        graphicsLabel = row(page, t('Graphics', 'Graphismes'), '…');
        row(page, t('Serial number', 'Numéro de série'), info.serial);
        row(page, t('System', 'Système'), info.os);
        row(page, t('Kernel', 'Noyau'), info.kernel);
        row(page, t('Desktop', 'Bureau'), info.shell);
        row(page, t('Uptime', 'Allumé depuis'), uptimeText());
        if (info.battery)
            row(page, t('Battery', 'Batterie'), `${info.battery} %`);
    });

    makeTab('displays', t('Displays', 'Écrans'), page => {
        const monitors = Main.layoutManager.monitors;
        monitors.forEach((m, i) => {
            const scale = global.display.get_monitor_scale(i);
            const name = monitors.length > 1
                ? `${t('Display', 'Écran')} ${i + 1}${i === Main.layoutManager.primaryIndex ? ` (${t('main', 'principal')})` : ''}`
                : t('Built-in display', 'Écran');
            row(page, name, `${m.width * scale} × ${m.height * scale}`);
            row(page, t('Scale', 'Échelle'), `${Math.round(scale * 100)} %`);
        });
        const refresh = (() => {
            try {
                return global.display.get_monitor_refresh_rate?.(Main.layoutManager.primaryIndex);
            } catch {
                return 0;
            }
        })();
        if (refresh)
            row(page, t('Refresh rate', 'Fréquence'), `${Math.round(refresh)} Hz`);
    });

    makeTab('storage', t('Storage', 'Stockage'), page => {
        const s = storageInfo();
        row(page, t('Macintosh HD', 'Disque système'), s.size ? gb(s.size) : '');
        const bar = new St.Widget({style_class: 'gnomac-about2-bar', height: 12, x_expand: true,
            layout_manager: new Clutter.BinLayout()});
        const used = new St.Widget({style_class: 'gnomac-about2-bar-used', x_align: Clutter.ActorAlign.START,
            y_expand: true});
        bar.add_child(used);
        // The bar is measured once it has a width.
        bar.connect('notify::width', () => used.set_width(Math.round(bar.width * (s.size ? s.used / s.size : 0))));
        page.add_child(bar);
        row(page, t('Used', 'Utilisé'), s.size ? `${gb(s.used)} (${Math.round(100 * s.used / s.size)} %)` : '');
        row(page, t('Available', 'Disponible'), s.size ? gb(s.free) : '');
    });
    select('overview');

    box.add_child(tabs);
    box.add_child(pages);

    // ----------------------------------------------------------- buttons
    const buttons = new St.BoxLayout({style_class: 'gnomac-about2-buttons', x_align: Clutter.ActorAlign.CENTER});
    const button = (label, action) => {
        const b = new St.Button({label, style_class: 'gnomac-about-button', can_focus: false});
        press(b, {down: 0.95});
        b.connect('clicked', () => {
            close();
            action();
        });
        buttons.add_child(b);
    };
    const launch = argv => {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'GNOMAC about');
        }
    };
    // GNOME's own About page, not the main Settings window.
    button(t('More Info…', 'Plus d’infos…'), () => launch(['gnome-control-center', 'system', 'about']));
    button(t('Software Update…', 'Mise à jour…'), () => launch(['gnome-software', '--mode=updates']));
    button(t('Report a Bug…', 'Signaler un bug…'), () => Gio.AppInfo.launch_default_for_uri(
        'https://github.com/Nayzer974/GNOMAC/issues', global.create_app_launch_context(0, -1)));
    box.add_child(buttons);
    box.add_child(new St.Label({text: `GNOMAC · ${info.os}`, style_class: 'gnomac-about-footer',
        x_align: Clutter.ActorAlign.CENTER}));
    card.add_child(box);
    root.add_child(card);

    Main.layoutManager.uiGroup.add_child(root);
    glass.setStageOrigin(x, y);
    const grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});

    graphics(name => {
        if (current && graphicsLabel && !graphicsLabel.is_finalized?.())
            graphicsLabel.text = name || t('Not available', 'Indisponible');
    });

    const close = () => {
        if (!current)
            return;
        current = null;
        Main.popModal(grab);
        root.ease({opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => root.destroy()});
    };
    root.connect('button-press-event', (actor, event) => {
        if (global.stage.get_event_actor(event) === actor)
            close();
        return Clutter.EVENT_PROPAGATE;
    });
    root.connect('key-press-event', (_a, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape)
            close();
        else if (symbol === Clutter.KEY_Right || symbol === Clutter.KEY_Left) {
            const index = tabButtons.findIndex(e => e.page.visible);
            const next = tabButtons[(index + (symbol === Clutter.KEY_Right ? 1 : tabButtons.length - 1)) % tabButtons.length];
            select(next.id);
        }
        return Clutter.EVENT_STOP;
    });
    global.stage.set_key_focus(root);

    card.set_pivot_point(0.5, 0.5);
    card.set_scale(0.94, 0.94);
    card.opacity = 0;
    card.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 240,
        mode: Clutter.AnimationMode.EASE_OUT_BACK});
    current = {close};
}

export function closeAbout() {
    current?.close();
}
