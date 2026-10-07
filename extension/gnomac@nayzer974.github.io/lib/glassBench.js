// Glass benchmark: N surfaces (1, 5, 10, 20, 50), once as separate GlassSurface
// and once as GlassContainer groups of 8 regions, repainted on every frame for
// 3 s each. Run it from Spotlight ("Glass Benchmark"); the results go to
// ~/.cache/gnomac/glass-bench.json and a notification.
//
// Measured: frames per second and frame time (stage after-paint), shell CPU
// (utime + stime from /proc/self/stat) and memory (VmRSS), plus what the
// architecture says (blur passes, backdrop captures and shader passes: one of
// each per surface, or per group). GPU time is NOT measured: GNOME Shell does
// not expose it. A smaller pass count is not a speed-up by itself: only the
// measured frame time says whether it was.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface} from './glass.js';
import {GlassContainer} from './glassContainer.js';
import {glassPerformance} from './glassPerformance.js';

const COUNTS = [1, 5, 10, 20, 50];
const W = 120;
const H = 64;
const GAP = 8;
const WARMUP_MS = 1000;
const MEASURE_MS = 3000;

const decode = bytes => new TextDecoder().decode(bytes);
const cpuTicks = () => {
    const f = decode(GLib.file_get_contents('/proc/self/stat')[1]).split(') ')[1].split(' ');
    return Number(f[11]) + Number(f[12]);
};
const rssMb = () => Math.round(Number(/VmRSS:\s+(\d+)/.exec(decode(GLib.file_get_contents('/proc/self/status')[1]))?.[1] ?? 0) / 1024);

function build(root, n, grouped, blur, glass) {
    const monitor = Main.layoutManager.primaryMonitor;
    const cols = Math.max(1, Math.floor((monitor.width - 80) / (W + GAP)));
    const cell = i => ({x: 40 + (i % cols) * (W + GAP), y: 60 + Math.floor(i / cols) * (H + GAP)});
    const list = [];
    if (!grouped) {
        for (let i = 0; i < n; i++) {
            const p = cell(i);
            const s = new GlassSurface({blur, glass});
            root.add_child(s);
            s.set_size(W, H);
            s.set_position(p.x, p.y);
            s.setStageOrigin(p.x, p.y);
            list.push(s);
        }
        return {list, groups: n};
    }
    // Groups of 8 consecutive cells, each laid out as a block of its own.
    for (let k = 0; k * 8 < n; k++) {
        const ids = [];
        for (let i = k * 8; i < Math.min(n, k * 8 + 8); i++)
            ids.push(i);
        const origin = cell(ids[0]);
        const xs = ids.map(i => cell(i).x);
        const ys = ids.map(i => cell(i).y);
        const c = new GlassContainer({blur, glass});
        root.add_child(c);
        c.set_position(origin.x, Math.min(...ys));
        c.set_size(Math.max(...xs) + W - Math.min(...xs), Math.max(...ys) + H - Math.min(...ys));
        c.setStageOrigin(c.x, c.y);
        ids.forEach(i => c.addRegion(`r${i}`, {x: cell(i).x - c.x, y: cell(i).y - c.y, width: W, height: H}, {radius: 18}));
        list.push(c);
    }
    return {list, groups: list.length};
}

function measure(n, grouped, settings) {
    return new Promise(resolve => {
        const root = new St.Widget({reactive: false});
        Main.layoutManager.uiGroup.add_child(root);
        const {list, groups} = build(root, n, grouped, settings.get_int('glass-blur'), {radius: 18});
        let frames = 0;
        const stageId = global.stage.connect('after-paint', () => frames++);
        const repaint = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            list.forEach(s => s.queue_redraw());
            return GLib.SOURCE_CONTINUE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, WARMUP_MS, () => {
            frames = 0;
            const cpu0 = cpuTicks();
            const t0 = GLib.get_monotonic_time();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, MEASURE_MS, () => {
                const seconds = (GLib.get_monotonic_time() - t0) / 1e6;
                const result = {
                    surfaces: n, grouped, groups,
                    fps: Number((frames / seconds).toFixed(1)),
                    frameMs: Number((1000 * seconds / Math.max(1, frames)).toFixed(1)),
                    cpuPercent: Math.round(100 * ((cpuTicks() - cpu0) / 100) / seconds),
                    memoryMb: rssMb(),
                    blurPasses: groups, backdropCaptures: groups, shaderPasses: groups,
                };
                global.stage.disconnect(stageId);
                GLib.source_remove(repaint);
                root.destroy();
                resolve(result);
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    });
}

let running = false;

export async function runGlassBench(extension) {
    if (running)
        return null;
    running = true;
    const settings = extension.getSettings();
    glassPerformance.benchmarking = true;
    Main.notify('Glass Benchmark', 'Running (about 45 s): the desktop will flicker, do not touch anything.');
    const results = [];
    try {
        for (const n of COUNTS) {
            for (const grouped of [false, true])
                results.push(await measure(n, grouped, settings));
        }
    } finally {
        glassPerformance.benchmarking = false;
        running = false;
    }
    const report = {
        date: new Date().toISOString(),
        quality: settings.get_string('glass-quality'),
        monitor: (({width, height}) => `${width}x${height}`)(Main.layoutManager.primaryMonitor),
        gpuTime: 'not measured (not exposed by GNOME Shell)',
        results,
    };
    try {
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac']);
        GLib.mkdir_with_parents(dir, 0o755);
        Gio.File.new_for_path(GLib.build_filenamev([dir, 'glass-bench.json']))
            .replace_contents(new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false,
                Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        logError(e, 'GNOMAC glass bench: results not saved');
    }
    const line = n => {
        const a = results.find(r => r.surfaces === n && !r.grouped);
        const b = results.find(r => r.surfaces === n && r.grouped);
        return `${n}: ${a.fps} fps separate, ${b.fps} grouped`;
    };
    Main.notify('Glass Benchmark', `${COUNTS.map(line).join('\n')}\nSaved in ~/.cache/gnomac/glass-bench.json`);
    return report;
}
