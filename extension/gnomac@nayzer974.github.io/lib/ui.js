// Shared sizing helper. Every pixel size in GNOMAC was designed on a
// 1280x800 logical screen; on a taller logical screen (a bigger VM window, a
// 4K monitor at scale 1) fixed pixels look tiny. The factor follows the
// primary monitor's logical height, so HiDPI scaling (which already shrinks
// the logical size) is handled too.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const REFERENCE_HEIGHT = 800;

export function uiScale() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor)
        return 1;
    return Math.max(0.85, Math.min(2, monitor.height / REFERENCE_HEIGHT));
}

// Icon size of the dock for the current settings and screen.
export function dockBaseSize(settings) {
    if (!settings.get_boolean('dock-auto-size'))
        return settings.get_int('dock-icon-size');
    const scaled = 48 * uiScale() * settings.get_double('dock-size-scale');
    return Math.max(32, Math.min(128, Math.round(scaled / 2) * 2));
}
