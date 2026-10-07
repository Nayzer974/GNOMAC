// Motion benchmark (Spotlight > "Motion Benchmark"): runs the real window
// animations on YOUR open windows and measures what the screen actually does.
//
//   scenarios: 1, 5, 10 and 20 windows. A scenario needs that many open
//   windows on the current workspace; with fewer it is skipped and says so
//   (open more windows, or use the scenarios you can).
//   each scenario: minimise all together, restore all together, then Mission
//   Control in and out (the windows travel to the dock and back, then to the
//   grid and back).
//
// Measured per scenario: mean and minimum FPS, mean and maximum frame time
// (only frames drawn while a motion runs), memory before and after, duration,
// and the largest number of motions running at once. Results go to
// ~/.cache/gnomac/motion-bench.json. The numbers describe the machine they
// were measured on: a software renderer (a virtual machine) says nothing
// about a real GPU, and the file records the renderer so that is visible.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {displayInfo} from './display.js';
import {glassPerformance} from './glassPerformance.js';
import {timelines} from './animationTimeline.js';
import {missionControl} from './missionControl.js';
import {collectDiagnostics} from './diagnostics.js';

const SCENARIOS = [1, 5, 10, 20];
const PHASE_MS = 900;
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

const rssMb = () => {
    try {
        const text = new TextDecoder().decode(GLib.file_get_contents('/proc/self/status')[1]);
        return Math.round(Number(/VmRSS:\s+(\d+)/.exec(text)?.[1] ?? NaN) / 1024);
    } catch {
        return null;
    }
};

function windows() {
    const workspace = global.workspace_manager.get_active_workspace();
    return global.get_window_actors().map(a => a.meta_window).filter(w =>
        w && !w.minimized && w.get_workspace() === workspace && w.get_window_type() === Meta.WindowType.NORMAL);
}

let running = false;

async function scenario(list) {
    const intervals = [];
    let last = 0;
    let peak = 0;
    const id = global.stage.connect('after-paint', () => {
        const now = GLib.get_monotonic_time();
        if (timelines.active > 0) {
            peak = Math.max(peak, timelines.active);
            if (last)
                intervals.push((now - last) / 1000);
        }
        last = timelines.active > 0 ? now : 0;
    });
    const memoryBefore = rssMb();
    const started = GLib.get_monotonic_time();
    list.forEach(w => w.minimize());
    await sleep(PHASE_MS);
    list.forEach(w => w.unminimize(global.get_current_time()));
    await sleep(PHASE_MS);
    missionControl.enterMissionControl();
    await sleep(PHASE_MS);
    missionControl.exitMissionControl(null);
    await sleep(PHASE_MS);
    global.stage.disconnect(id);
    const duration = Math.round((GLib.get_monotonic_time() - started) / 1000);
    const total = intervals.reduce((a, b) => a + b, 0);
    const worst = Math.max(0, ...intervals);
    return {
        windows: list.length,
        frames: intervals.length,
        fpsMean: intervals.length ? Number((1000 * intervals.length / total).toFixed(1)) : null,
        fpsMin: worst ? Number((1000 / worst).toFixed(1)) : null,
        frameMsMean: intervals.length ? Number((total / intervals.length).toFixed(1)) : null,
        frameMsMax: worst ? Number(worst.toFixed(1)) : null,
        memoryBeforeMb: memoryBefore,
        memoryAfterMb: rssMb(),
        durationMs: duration,
        maxSimultaneousMotions: peak,
    };
}

export async function runMotionBench(extension) {
    if (running)
        return null;
    running = true;
    glassPerformance.benchmarking = true;
    const available = windows();
    Main.notify('Motion Benchmark', `Running on ${available.length} open windows (about ${SCENARIOS.filter(n => n <= available.length).length * 4} s per scenario). Do not touch anything.`);
    const results = [];
    try {
        for (const n of SCENARIOS) {
            if (available.length < n) {
                results.push({windows: n, skipped: `needs ${n} open windows on this workspace, found ${available.length}`});
                continue;
            }
            results.push(await scenario(available.slice(0, n)));
            await sleep(400);
        }
    } finally {
        glassPerformance.benchmarking = false;
        running = false;
        available.forEach(w => {
            if (w.minimized)
                w.unminimize(global.get_current_time());
        });
    }
    const diagnostics = await collectDiagnostics(extension);
    const report = {
        date: new Date().toISOString(),
        refreshHz: displayInfo.refreshHz,
        resolution: displayInfo.resolution,
        environment: diagnostics.split('\n').filter(l => /^(GNOME|Renderer|GPU|CPU)/.test(l)),
        note: 'FPS and frame times cover only frames drawn while a motion was running. GPU time is not measured.',
        results,
    };
    try {
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac']);
        GLib.mkdir_with_parents(dir, 0o755);
        Gio.File.new_for_path(GLib.build_filenamev([dir, 'motion-bench.json']))
            .replace_contents(new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false,
                Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        logError(e, 'GNOMAC motion bench: results not saved');
    }
    const line = r => (r.skipped ? `${r.windows}: skipped (${r.skipped})`
        : `${r.windows}: ${r.fpsMean} fps (min ${r.fpsMin}), ${r.frameMsMean} ms (max ${r.frameMsMax})`);
    Main.notify('Motion Benchmark', `${results.map(line).join('\n')}\nSaved in ~/.cache/gnomac/motion-bench.json`);
    return report;
}
