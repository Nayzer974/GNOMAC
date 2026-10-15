// Timers for the benchmarks (Spotlight: "Glass Benchmark", "Motion Benchmark")
// that can all be stopped at once. A benchmark runs for tens of seconds, and
// the module that started it can be switched off in the middle: its timers
// must not keep repainting and moving windows after that.
//
//   benchSleep(ms)        a promise that resolves after ms, or rejects with
//                         BenchCancelled when cancelBenchmarks() is called
//   benchInterval(ms, fn) calls fn every ms; returns a function that stops it
//   cancelBenchmarks()    stops every timer and rejects every sleep

import GLib from 'gi://GLib';

export class BenchCancelled extends Error {
    constructor() {
        super('benchmark cancelled');
        this.name = 'BenchCancelled';
    }
}

const sleeps = new Map();   // source id -> reject
const intervals = new Set();

export function benchSleep(ms) {
    return new Promise((resolve, reject) => {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            sleeps.delete(id);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        sleeps.set(id, reject);
    });
}

export function benchInterval(ms, callback) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        callback();
        return GLib.SOURCE_CONTINUE;
    });
    intervals.add(id);
    return () => {
        if (intervals.delete(id))
            GLib.source_remove(id);
    };
}

export function cancelBenchmarks() {
    for (const [id, reject] of sleeps) {
        GLib.source_remove(id);
        reject(new BenchCancelled());
    }
    sleeps.clear();
    for (const id of intervals)
        GLib.source_remove(id);
    intervals.clear();
}

// For tests: how many timers are still alive.
export const pendingBenchTimers = () => sleeps.size + intervals.size;
