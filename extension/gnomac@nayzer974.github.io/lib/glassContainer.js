// GlassContainer: several glass regions drawn as ONE piece of glass.
//
// A GlassSurface costs one backdrop copy, one blur pass and one glass shader
// pass. Ten separate surfaces cost ten of each. A container holds up to
// MAX_REGIONS (8) regions (a dock plate and a hover lens, an island and its
// extension...) behind a single backdrop, a single blur and a single shader
// pass: the regions share the same blurred background (no double blur) and
// melt into each other where they touch (smooth union, `merge`).
//
// Regions are positioned in the container's own coordinates. The container
// actor covers their bounding box; the shader only paints inside the regions.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {GlassSurface, liveSurfaces} from './glass.js';
import {TOKENS} from './glassTokens.js';

export const MAX_REGIONS = 8;
let nextId = 1;

const EASE = t => 1 - (1 - t) ** 3;

export const GlassContainer = GObject.registerClass(
class GlassContainer extends GlassSurface {
    // renderContext: where the backdrop comes from, shared by all regions.
    _init({containerId = `glass-group-${nextId++}`, merge = 0, renderContext = null, ...rest} = {}) {
        super._init(rest);
        this.containerId = containerId;
        this._merge = merge;
        this._regions = new Map();
        this._renderContext = renderContext ?? rest.backdrop ?? 'wallpaper';
        this._regionTimelines = new Map();
        this.connect('destroy', () => {
            for (const t of this._regionTimelines.values())
                t.stop();
        });
    }

    // bounds: {x, y, width, height} in container coordinates.
    // materialParameters: kept with the region (read back through
    // getGlassGroup()); the shader applies the container's material to all of them.
    addRegion(surfaceId, bounds, {radius = 18, zIndex = 0, materialParameters = null} = {}) {
        if (!this._regions.has(surfaceId) && this._regions.size >= MAX_REGIONS) {
            log(`GNOMAC glass: group ${this.containerId} already has ${MAX_REGIONS} regions, "${surfaceId}" ignored`);
            return false;
        }
        this._regions.set(surfaceId, {surfaceId, bounds: {...bounds}, radius, zIndex, materialParameters});
        this._applyRegions();
        return true;
    }

    updateRegion(surfaceId, bounds, radius) {
        const region = this._regions.get(surfaceId);
        if (!region)
            return;
        Object.assign(region.bounds, bounds);
        if (radius !== undefined)
            region.radius = radius;
        this._applyRegions();
    }

    removeRegion(surfaceId) {
        this._regionTimelines.get(surfaceId)?.stop();
        this._regionTimelines.delete(surfaceId);
        if (this._regions.delete(surfaceId))
            this._applyRegions();
    }

    // One region glides from its current shape to another (the same region is
    // kept alive: nothing is hidden, created or destroyed).
    morphRegion(surfaceId, to, {duration = TOKENS.animationNormal, onDone = null} = {}) {
        const region = this._regions.get(surfaceId);
        if (!region)
            return;
        this._regionTimelines.get(surfaceId)?.stop();
        const from = {...region.bounds, radius: region.radius};
        const target = {...from, ...to};
        if (!St.Settings.get().enable_animations || !this.get_stage()) {
            this.updateRegion(surfaceId, target, target.radius);
            onDone?.();
            return;
        }
        const timeline = new Clutter.Timeline({actor: this, duration});
        this._regionTimelines.set(surfaceId, timeline);
        const apply = f => {
            const v = {};
            for (const k of ['x', 'y', 'width', 'height', 'radius'])
                v[k] = from[k] + (target[k] - from[k]) * f;
            this.updateRegion(surfaceId, v, v.radius);
        };
        timeline.connect('new-frame', () => apply(EASE(timeline.get_progress())));
        timeline.connect('completed', () => {
            this._regionTimelines.delete(surfaceId);
            apply(1);
            onDone?.();
        });
        timeline.start();
    }

    setMerge(k) {
        this._merge = k;
        this._applyRegions();
    }

    // The bounding box of all the regions.
    get groupBounds() {
        const list = [...this._regions.values()];
        if (!list.length)
            return {x: 0, y: 0, width: this.width, height: this.height};
        const x0 = Math.min(...list.map(r => r.bounds.x));
        const y0 = Math.min(...list.map(r => r.bounds.y));
        const x1 = Math.max(...list.map(r => r.bounds.x + r.bounds.width));
        const y1 = Math.max(...list.map(r => r.bounds.y + r.bounds.height));
        return {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
    }

    getGlassGroup() {
        return {
            containerId: this.containerId,
            groupBounds: this.groupBounds,
            surfaces: [...this._regions.values()].sort((a, b) => a.zIndex - b.zIndex).map(r => ({
                surfaceId: r.surfaceId, bounds: {...r.bounds}, radius: r.radius, zIndex: r.zIndex,
                materialParameters: r.materialParameters,
            })),
            // What one frame of this group costs, however many regions it holds.
            renderPasses: {backdrop: 1, blur: 1, glass: 1},
        };
    }

    // The backdrop shared by every region of the group.
    getBackdropContext() {
        return {
            renderContext: this._renderContext,
            blurRadius: this._baseBlur,
            stageOrigin: [...this._origin],
            sampled: this.sampleBackdrop(),
        };
    }

    _applyRegions() {
        const list = [...this._regions.values()].sort((a, b) => a.zIndex - b.zIndex);
        const regions = [];
        const radii = [];
        list.forEach((r, i) => {
            regions[i] = [r.bounds.x, r.bounds.y, Math.max(0, r.bounds.width), Math.max(0, r.bounds.height)];
            radii[i] = r.radius;
        });
        this._userParams.regions = regions;
        this._userParams.regionRadii = radii;
        this._userParams.merge = this._merge;
        this._pushGlass();
    }
});

// Every glass on screen as a group: a container is one group of N surfaces, a
// plain GlassSurface is a group of one. This is what the debug overlay shows.
export function glassGroups() {
    const groups = [];
    for (const surface of liveSurfaces) {
        if (!surface.get_stage?.() || surface.width < 2 || surface.height < 2)
            continue;
        const [x, y] = surface.get_transformed_position();
        if (surface instanceof GlassContainer) {
            const g = surface.getGlassGroup();
            groups.push({id: g.containerId, count: g.surfaces.length, x: x + g.groupBounds.x, y: y + g.groupBounds.y,
                width: g.groupBounds.width, height: g.groupBounds.height, passes: 3});
        } else {
            groups.push({id: surface.constructor.name, count: 1, x, y, width: surface.width, height: surface.height, passes: 3});
        }
    }
    return groups;
}
