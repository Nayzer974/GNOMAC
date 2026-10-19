// GNOMAC Diagnostics (Spotlight > "GNOMAC Diagnostics"): what this machine and
// this shell really are, in one panel, also saved to
// ~/.cache/gnomac/diagnostics.txt so it can be pasted in a bug report.
// A value that cannot be read is shown as N/A. Nothing is guessed.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {displayInfo} from './display.js';
import {glassPerformance} from './glassPerformance.js';
import {glassGroups} from './glassContainer.js';
import {timelines} from './animationTimeline.js';
import {desktopLayer} from './desktopLayer.js';
import {reducedMotion} from './motionTokens.js';
import {readInstalled} from '../modules/updater.js';

const NA = 'N/A';
const read = path => {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch {
        return null;
    }
};

// Runs a command and gives its output (or null if it is missing or fails).
function run(argv) {
    return new Promise(resolve => {
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    resolve(p.get_successful() ? out : null);
                } catch {
                    resolve(null);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

const cpuModel = () => /model name\s*:\s*(.+)/.exec(read('/proc/cpuinfo') ?? '')?.[1]?.trim() ?? NA;

function memory() {
    const info = read('/proc/meminfo') ?? '';
    const kb = key => Number(new RegExp(`${key}:\\s+(\\d+)`).exec(info)?.[1] ?? NaN);
    const total = kb('MemTotal');
    const free = kb('MemAvailable');
    return Number.isFinite(total) ? `${Math.round(total / 1024)} MB (${Math.round(free / 1024)} MB available)` : NA;
}

function shellMemoryMb() {
    const kb = Number(/VmRSS:\s+(\d+)/.exec(read('/proc/self/status') ?? '')?.[1] ?? NaN);
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
}

async function gpu() {
    const lspci = await run(['lspci', '-mm']);
    if (lspci) {
        const lines = lspci.split('\n').filter(l => /"(VGA compatible controller|3D controller|Display controller)"/.test(l));
        const names = lines.map(l => [...l.matchAll(/"([^"]*)"/g)].map(m => m[1]).slice(2, 4).join(' '));
        if (names.length)
            return names.join(' + ');
    }
    return NA;
}

// The OpenGL renderer string, when the diagnostic tool is installed.
async function renderer() {
    for (const argv of [['eglinfo', '-B'], ['glxinfo', '-B']]) {
        const out = await run(argv);
        const match = /(?:OpenGL ES profile|OpenGL core profile|OpenGL renderer string)[^\n]*?renderer string:\s*(.+)/i.exec(out ?? '') ??
            /renderer string:\s*(.+)/i.exec(out ?? '');
        if (match)
            return match[1].trim();
    }
    return `${NA} (install mesa-utils / mesa-demos to read it)`;
}

export async function collectDiagnostics(extension) {
    const settings = extension.getSettings();
    const [gpuName, rendererName] = await Promise.all([gpu(), renderer()]);
    await new Promise(resolve => displayInfo.refresh(resolve));
    const installed = readInstalled();
    const groups = glassGroups();
    const regions = groups.reduce((n, g) => n + g.count, 0);
    const perf = glassPerformance;
    const battery = perf.battery ? `${Math.round(perf.battery.percent)} % (state ${perf.battery.state})` : NA;
    const hz = displayInfo.refreshHz;
    const mem = shellMemoryMb();
    const lines = [
        'GNOMAC',
        '──────────────',
        `GNOME version:     ${Config.PACKAGE_VERSION ?? NA}`,
        `GNOMAC version:    ${extension.metadata?.['version-name'] ?? extension.metadata?.version ?? NA} (installed commit ${installed?.sha?.slice(0, 7) ?? NA})`,
        `Session:           ${Meta.is_wayland_compositor() ? 'Wayland' : 'X11'}`,
        `Renderer:          ${rendererName}`,
        `GPU:               ${gpuName}`,
        `Refresh rate:      ${hz ? `${hz} Hz` : NA}`,
        `Resolution:        ${displayInfo.resolution ?? NA}`,
        `CPU:               ${cpuModel()}`,
        `RAM:               ${memory()}`,
        `Shell memory:      ${mem === null ? NA : `${mem} MB`}`,
        '',
        'Liquid Glass',
        '──────────────',
        `Quality:           ${settings.get_string('glass-quality')} (ceiling), running at ${perf.level}`,
        `Backdrop:          wallpaper sampling + window-group clone (no per-region compositor capture)`,
        `Shader:            ${perf.level}`,
        `Glass groups:      ${groups.length}`,
        `Regions:           ${regions}`,
        `Blur passes:       ${groups.length}`,
        '',
        'Desktop',
        '──────────────',
        `Desktop layer:    ${desktopLayer.actor ? desktopLayer.describe() : 'not running'}`,
        '',
        'Motion',
        '──────────────',
        `Active animations: ${timelines.active}`,
        `FPS:               ${perf.fps ? `${perf.fps.toFixed(1)} (measured while animating)` : `${NA} (no animation measured yet)`}`,
        `Frame time:        ${perf.frameMs ? `${perf.frameMs.toFixed(1)} ms` : NA}`,
        '',
        'System',
        '──────────────',
        `Reduced Motion:    ${reducedMotion() ? 'on' : 'off'}`,
        `Power mode:        ${perf.powerCap === 'low' ? 'power-saver' : 'not power-saver'} (cap ${perf.powerCap})`,
        `Battery:           ${battery} (cap ${perf.batteryCap})`,
    ];
    return lines.join('\n');
}

let panel = null;

export function closeDiagnostics() {
    panel?.destroy();
    panel = null;
}

export async function showDiagnostics(extension) {
    closeDiagnostics();
    const text = await collectDiagnostics(extension);
    try {
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac']);
        GLib.mkdir_with_parents(dir, 0o755);
        Gio.File.new_for_path(GLib.build_filenamev([dir, 'diagnostics.txt']))
            .replace_contents(new TextEncoder().encode(`${text}\n`), null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        logError(e, 'GNOMAC diagnostics: not saved');
    }
    const monitor = Main.layoutManager.primaryMonitor;
    panel = new St.Label({style_class: 'gnomac-glass-debug', text: `${text}\n\n(click to close, saved in ~/.cache/gnomac/diagnostics.txt)`,
        reactive: true});
    Main.layoutManager.uiGroup.add_child(panel);
    panel.set_position(monitor.x + Math.round((monitor.width - panel.width) / 2), monitor.y + Main.panel.height + 20);
    panel.connect('button-press-event', () => {
        closeDiagnostics();
        return Clutter.EVENT_STOP;
    });
    return text;
}
