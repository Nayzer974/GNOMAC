// The start-up lens: a disc of liquid glass that opens at the centre of the
// screen and grows until it covers it (modules/bootShutdown.js, style "lens").
//
// It is NOT a GlassSurface that is resized every frame. Resizing a surface that
// carries two offscreen effects (the blur and the glass shader) reallocates
// their textures on each frame, up to a square larger than the screen, and the
// glass shader (regions, gradient, blur ring) is far heavier than a disc needs.
// Here the actor keeps the monitor's size for good, the wallpaper is painted
// once into its offscreen texture, and one small shader draws the disc. The
// only thing that changes while it grows is one number, the radius.
//
// The look is the glass one: the wallpaper bends at the rim like through a
// lens (strongest at the edge, with a little colour dispersion), a hairline of
// light runs along the edge, brighter on the side facing the light.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GLSLEffect} from './shaderEffect.js';

const HOOK = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

const MAX_RIM = 90;      // px, widest bevel
const BEND = 1.25;       // refraction at the edge, in bevel widths
const CHROMA = 6;        // px of colour dispersion at the edge
const TINT = [0.02, 0.03, 0.06, 0.04];
const LIGHT_ANGLE = 55 * Math.PI / 180;

const DECLARATIONS = `
uniform sampler2D tex;
uniform vec2 size;
uniform vec2 centre;     // px
uniform float radius;    // px
uniform float rim_w;     // bevel width, px
uniform float bend;      // refraction at the edge, px
uniform float chroma;
uniform vec4 tint;
uniform vec2 light_dir;

// 0 inside, 1 at the edge: a circular bevel, the slope at the edge softened.
float circular_lens(float din, float w) {
    float x = 1.0 - clamp(din / w, 0.0, 1.0);
    float e = clamp(2.0 / w, 0.0001, 0.5);
    float top = sqrt(1.0 + e);
    return (top - sqrt(max(1.0 - x * x, 0.0) + e)) / (top - sqrt(e));
}
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].st;
vec2 v = uv * size - centre;
float dist = length(v);
float d = dist - radius;
cogl_color_out = vec4(0.0);
if (d < 1.5) {
    float mask = 1.0 - smoothstep(-1.0, 0.5, d);
    float din = max(-d, 0.0);
    vec3 col;
    if (din > rim_w) {
        // Deep inside the disc the glass is flat: one sample.
        col = texture2D(tex, uv).rgb;
        col = mix(col, tint.rgb, tint.a);
        cogl_color_out = vec4(col * mask, mask);
    } else {
        vec2 n = dist > 0.001 ? v / dist : vec2(0.0);
        float prof = 0.5 * (circular_lens(din - 0.25, rim_w) + circular_lens(din + 0.25, rim_w));
        float prof2 = 0.5 * (circular_lens(din - 0.25, rim_w * 0.5) + circular_lens(din + 0.25, rim_w * 0.5));
        vec2 shift = -n * prof * bend / size;
        vec2 split = n * prof2 * chroma / size;
        col.r = texture2D(tex, clamp(uv + shift + split, 0.0, 1.0)).r;
        col.g = texture2D(tex, clamp(uv + shift, 0.0, 1.0)).g;
        col.b = texture2D(tex, clamp(uv + shift - split, 0.0, 1.0)).b;
        col = mix(col, tint.rgb, tint.a);

        // Hairline of light on the edge, two lobes (the lit side, and the faint
        // light that went through), a faint glow on the bevel, fresnel.
        float band = 1.0 - smoothstep(0.0, 1.3, din);
        float lobe1 = pow(max(dot(n, light_dir), 0.0), 2.0);
        float lobe2 = pow(max(dot(n, -light_dir), 0.0), 2.0) * 0.5;
        float rim_light = band * (0.12 + 0.42 * (lobe1 + lobe2));
        float inset_glow = exp(-din / max(rim_w * 0.4, 3.0)) * 0.05 * (lobe1 + 0.25);
        float fres = pow(1.0 - clamp(din / rim_w, 0.0, 1.0), 3.0) * 0.55;
        col = col + vec3(0.94, 0.97, 1.0) * (rim_light + inset_glow + fres * 0.3) * (1.0 - col);
        cogl_color_out = vec4(col * mask, mask);
    }
}
`;

const LensEffect = GObject.registerClass(
class LensEffect extends GLSLEffect {
    _init(centre) {
        super._init();
        this._loc = {};
        for (const name of ['size', 'centre', 'radius', 'rim_w', 'bend', 'chroma', 'tint', 'light_dir'])
            this._loc[name] = this.get_uniform_location(name);
        this.set_uniform_float(this._loc.centre, 2, centre);
        this.set_uniform_float(this._loc.chroma, 1, [CHROMA]);
        this.set_uniform_float(this._loc.tint, 4, TINT);
        this.set_uniform_float(this._loc.light_dir, 2, [Math.cos(LIGHT_ANGLE), -Math.sin(LIGHT_ANGLE)]);
        this.setRadius(1);
    }

    buildPipeline() {
        this.add_glsl_snippet(HOOK, DECLARATIONS, CODE, false);
    }

    setRadius(radius) {
        const rim = Math.max(2, Math.min(radius * 2 * 0.45, MAX_RIM));
        this.set_uniform_float(this._loc.radius, 1, [radius]);
        this.set_uniform_float(this._loc.rim_w, 1, [rim]);
        this.set_uniform_float(this._loc.bend, 1, [rim * BEND]);
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        if (actor)
            this.set_uniform_float(this._loc.size, 2, [actor.width, actor.height]);
        super.vfunc_paint_target(node, paintContext);
    }
});

// The wallpaper, monitor-sized, seen through the disc. `centre` is in actor
// pixels. Put it on a stage-sized overlay whose origin is the monitor's.
export const LensSurface = GObject.registerClass(
class LensSurface extends Clutter.Actor {
    _init(monitor, centre) {
        super._init({width: monitor.width, height: monitor.height, clip_to_allocation: true, reactive: false});
        // Our own copy of the wallpaper (a clone of GNOME's would be culled
        // wherever a window sits; there is none at start-up, but the lens is
        // also previewed with windows open).
        this._source = new Meta.BackgroundGroup();
        this._bgManager = new Background.BackgroundManager({
            container: this._source,
            monitorIndex: Main.layoutManager.primaryIndex,
            controlPosition: false,
        });
        this.add_child(this._source);
        this._lens = new LensEffect(centre);
        this.add_effect(this._lens);
        this.connect('destroy', () => {
            this._bgManager?.destroy();
            this._bgManager = null;
        });
    }

    setRadius(radius) {
        this._lens.setRadius(radius);
    }
});
