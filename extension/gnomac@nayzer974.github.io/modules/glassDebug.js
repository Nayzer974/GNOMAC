// Liquid Glass debug overlay, off by default (setting glass-debug, or Spotlight
// "Liquid Glass debug"). Shows the number of live glass surfaces, the quality
// level, the wallpaper brightness steering the glass, whether animations are
// on, and the frame rate. `glass-debug-mode` additionally shows one layer of
// the material alone (1 backdrop, 2 refraction, 3 fresnel, 4 specular, 5 rim,
// 6 tint) on every surface.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {liveSurfaces} from '../lib/glass.js';
import {glassGroups} from '../lib/glassContainer.js';
import {adaptive} from '../lib/adaptive.js';
import {glassPerformance} from '../lib/glassPerformance.js';

const MODES = ['off', 'backdrop', 'refraction', 'fresnel', 'specular', 'rim', 'tint'];

export class GlassDebug {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._frames = 0;
    }

    enable() {
        this._extension.glassDebug = this;
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'glass-debug' || key === 'glass-inspector')
                this._sync();
            else if (key === 'glass-debug-groups')
                this._syncGroups();
            else if (key === 'glass-debug-mode')
                this._applyMode();
        });
        this._sync();
        this._syncGroups();
    }

    disable() {
        if (this._extension.glassDebug === this)
            this._extension.glassDebug = null;
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._hide();
        this._hideGroups();
    }

    toggleInspector() {
        this._settings.set_boolean('glass-inspector', !this._settings.get_boolean('glass-inspector'));
    }

    toggleGroups() {
        this._settings.set_boolean('glass-debug-groups', !this._settings.get_boolean('glass-debug-groups'));
    }

    // SHOW GROUPS: an outline around every glass group with its id, how many
    // surfaces it holds and its render passes (backdrop + blur + glass = 3 per
    // group, however many surfaces share it).
    _syncGroups() {
        if (!this._settings.get_boolean('glass-debug-groups')) {
            this._hideGroups();
            return;
        }
        if (this._groupsTimeout)
            return;
        this._outlines = [];
        this._drawGroups();
        this._groupsTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._drawGroups();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _hideGroups() {
        if (this._groupsTimeout) {
            GLib.source_remove(this._groupsTimeout);
            this._groupsTimeout = 0;
        }
        for (const o of this._outlines ?? [])
            o.destroy();
        this._outlines = [];
    }

    _drawGroups() {
        for (const o of this._outlines)
            o.destroy();
        this._outlines = [];
        for (const g of glassGroups()) {
            const box = new St.Widget({style_class: 'gnomac-glass-group', reactive: false,
                x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height)});
            const label = new St.Label({style_class: 'gnomac-glass-group-label',
                text: `${g.id} · ${g.count} surf · ${g.passes} passes`, reactive: false});
            box.add_child(label);
            Main.layoutManager.uiGroup.add_child(box);
            this._outlines.push(box);
        }
    }

    toggle() {
        this._settings.set_boolean('glass-debug', !this._settings.get_boolean('glass-debug'));
    }

    _applyMode() {
        const mode = this._settings.get_int('glass-debug-mode');
        for (const surface of liveSurfaces)
            surface.setDebugMode(mode);
    }

    _sync() {
        if (this._settings.get_boolean('glass-debug') || this._settings.get_boolean('glass-inspector'))
            this._show();
        else
            this._hide();
        this._update();
    }

    _show() {
        if (this._label)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        this._label = new St.Label({style_class: 'gnomac-glass-debug', reactive: false,
            x: monitor.x + monitor.width - 270, y: monitor.y + Main.panel.height + 12});
        Main.layoutManager.uiGroup.add_child(this._label);
        this._frameId = global.stage.connect('after-paint', () => this._frames++);
        this._since = GLib.get_monotonic_time();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
        this._update();
    }

    _hide() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._frameId) {
            global.stage.disconnect(this._frameId);
            this._frameId = 0;
        }
        this._label?.destroy();
        this._label = null;
    }

    // The Glass Inspector: everything the glass engine is doing right now.
    _inspect(fps, groups, regions) {
        const perf = glassPerformance;
        const upper = s => s.toUpperCase();
        const morphing = [];
        const forming = [];
        for (const s of liveSurfaces) {
            if (s._morphTimeline)
                morphing.push(Math.round(s._morphTimeline.get_progress() * 100));
            if (s._formTimeline)
                forming.push(Math.round(s._formTimeline.get_progress() * 100));
        }
        const params = [...liveSurfaces][0]?._glass?._params;
        let rss = 0;
        try {
            const text = new TextDecoder().decode(GLib.file_get_contents('/proc/self/status')[1]);
            rss = Math.round(parseInt(/VmRSS:\s+(\d+)/.exec(text)?.[1] ?? '0') / 1024);
        } catch {}
        const island = this._extension._modules?.find(m => m.constructor.name === 'DynamicIsland')?.state ?? '-';
        return [
            'GLASS',
            `FPS: ${fps}${perf.fps ? ` (while animating ${perf.fps.toFixed(0)}, ${perf.frameMs.toFixed(1)} ms)` : ''}`,
            `Groups: ${groups.length}`,
            `Regions: ${regions}`,
            `Blur passes: ${groups.length} (${regions} ungrouped)`,
            `Backdrop: ${upper(perf.level)}`,
            `Shader: ${upper(perf.level)}  (setting ${upper(perf.ceiling)}, auto ${upper(perf.autoLevel)}, power ${upper(perf.powerCap)})`,
            `Blur ${params ? Math.round([...liveSurfaces][0]._blur.radius) : '-'}  Fresnel ${params ? params.fresnel.toFixed(2) : '-'}  Refraction ${params ? params.refraction.toFixed(1) : '-'}`,
            `Materialization: ${forming.length ? forming.map(p => `${p}%`).join(' ') : 'idle'}`,
            `Morph: ${morphing.length ? morphing.map(p => `${p}%`).join(' ') : 'idle'}`,
            `Reduced motion: ${perf.reducedMotion ? 'on' : 'off'}`,
            `Island: ${island}   Wallpaper luminance ${adaptive.luminance.toFixed(2)}`,
            `Memory (shell): ${rss} MB`,
        ].join('\n');
    }

    _update() {
        if (!this._label)
            return;
        const now = GLib.get_monotonic_time();
        const fps = Math.round(this._frames / Math.max(0.1, (now - this._since) / 1e6));
        this._frames = 0;
        this._since = now;
        const mode = MODES[this._settings.get_int('glass-debug-mode')] ?? 'off';
        const groups = glassGroups();
        const regions = groups.reduce((n, g) => n + g.count, 0);
        if (this._settings.get_boolean('glass-inspector')) {
            this._label.text = this._inspect(fps, groups, regions);
            this._place();
            return;
        }
        this._label.text = [
            `Liquid Glass · ${this._settings.get_string('glass-quality')}`,
            `surfaces ${regions}   groups ${groups.length}   fps ${fps}`,
            `blur passes ${groups.length} (${regions} without grouping)`,
            `island ${this._extension._modules?.find(m => m.constructor.name === 'DynamicIsland')?.state ?? '-'}`,
            `wallpaper luminance ${adaptive.luminance.toFixed(2)} (adapt ${adaptive.amount.toFixed(2)})`,
            `animations ${St.Settings.get().enable_animations ? 'on' : 'off'}   layer ${mode}`,
        ].join('\n');
        this._place();
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        this._label.set_position(monitor.x + monitor.width - this._label.width - 12, this._label.y);
    }
}
