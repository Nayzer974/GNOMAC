// "About This Mac": a centred glass card like RevoShell's AboutWindow,
// with the machine illustration, model, processor, memory, serial number
// and system version read from the machine itself.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface} from './glass.js';
import {t} from './i18n.js';

function read(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : '';
    } catch {
        return '';
    }
}

function machineInfo() {
    const product = read('/sys/class/dmi/id/product_name');
    const vendor = read('/sys/class/dmi/id/sys_vendor');
    const serial = read('/sys/class/dmi/id/product_serial') || read('/etc/machine-id').slice(0, 12).toUpperCase();
    const cpu = (read('/proc/cpuinfo').match(/model name\s*:\s*(.+)/) ?? [])[1] ?? '';
    const memKb = Number((read('/proc/meminfo').match(/MemTotal:\s*(\d+)/) ?? [])[1] ?? 0);
    const os = (read('/etc/os-release').match(/PRETTY_NAME="?([^"\n]+)/) ?? [])[1] ?? 'Linux';
    const chassis = Number(read('/sys/class/dmi/id/chassis_type'));
    const laptop = [8, 9, 10, 14, 31, 32].includes(chassis);
    return {
        model: [vendor, product].filter(Boolean).join(' ') || GLib.get_host_name(),
        kind: laptop ? t('Laptop', 'Ordinateur portable') : t('Desktop', 'Ordinateur de bureau'),
        laptop,
        cpu: cpu.replace(/\s+/g, ' ').replace(/\(R\)|\(TM\)/g, ''),
        memory: memKb ? `${Math.round(memKb / 1024 / 1024)} ${t('GB', 'Go')}` : '',
        serial,
        os,
        shell: `GNOME ${Config.PACKAGE_VERSION}`,
    };
}

let current = null;

export function showAbout() {
    if (current) {
        current.close();
        return;
    }
    const info = machineInfo();
    const monitor = Main.layoutManager.primaryMonitor;
    const width = 330;
    const height = 430;
    const x = Math.round(monitor.x + (monitor.width - width) / 2);
    const y = Math.round(monitor.y + (monitor.height - height) / 2 - 30);

    const root = new St.Widget({reactive: true, x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height});
    const card = new St.Widget({x: x - monitor.x, y: y - monitor.y, width, height,
        style_class: 'gnomac-about', reactive: true});
    const glass = new GlassSurface({backdrop: 'windows', blur: 50,
        glass: {radius: 22, refraction: 10, thickness: 18, chroma: 1.2, rim: 0.6,
            tint: [0.07, 0.07, 0.09, 0.45]}});
    glass.set_size(width, height);
    card.add_child(glass);

    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gnomac-about-box', width, height});
    box.add_child(new St.Icon({
        icon_name: info.laptop ? 'computer-laptop-symbolic' : 'computer-symbolic',
        icon_size: 96, style_class: 'gnomac-about-machine', x_align: Clutter.ActorAlign.CENTER,
    }));
    box.add_child(new St.Label({text: info.model, style_class: 'gnomac-about-model',
        x_align: Clutter.ActorAlign.CENTER}));
    box.add_child(new St.Label({text: info.kind, style_class: 'gnomac-about-kind',
        x_align: Clutter.ActorAlign.CENTER}));

    const grid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gnomac-about-grid', x_align: Clutter.ActorAlign.CENTER});
    const row = (key, value) => {
        if (!value)
            return;
        const r = new St.BoxLayout({style_class: 'gnomac-about-row'});
        r.add_child(new St.Label({text: key, style_class: 'gnomac-about-key'}));
        r.add_child(new St.Label({text: value, style_class: 'gnomac-about-value'}));
        grid.add_child(r);
    };
    row(t('Chip', 'Puce'), info.cpu);
    row(t('Memory', 'Mémoire'), info.memory);
    row(t('Serial number', 'Numéro de série'), info.serial);
    row(t('System', 'Système'), info.os);
    row(t('Desktop', 'Bureau'), info.shell);
    box.add_child(grid);

    const buttons = new St.BoxLayout({style_class: 'gnomac-about-buttons', x_align: Clutter.ActorAlign.CENTER});
    const button = (label, action) => {
        const b = new St.Button({label, style_class: 'gnomac-about-button'});
        b.connect('clicked', () => {
            close();
            action();
        });
        buttons.add_child(b);
    };
    button(t('More Info…', 'Plus d’infos…'), () => Shell.AppSystem.get_default()
        .lookup_app('org.gnome.Settings.desktop')?.activate());
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
        if (event.get_key_symbol() === Clutter.KEY_Escape)
            close();
        return Clutter.EVENT_STOP;
    });
    global.stage.set_key_focus(root);

    card.set_pivot_point(0.5, 0.5);
    card.set_scale(0.94, 0.94);
    card.opacity = 0;
    card.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 220,
        mode: Clutter.AnimationMode.EASE_OUT_BACK});
    current = {close};
}

export function closeAbout() {
    current?.close();
}
