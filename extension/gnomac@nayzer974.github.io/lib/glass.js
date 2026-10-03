// Liquid Glass material.
//
// RevoShell's Quickshell shader refracts a flat colour rectangle, so its glass
// only looks real thanks to a Hyprland plugin. Here the refraction samples real
// pixels: a GlassSurface holds a blurred clone of the wallpaper aligned to its
// stage position, and GlassEffect bends that texture near the rounded edges
// (Snell-like lens profile), splits RGB slightly (chromatic dispersion) and
// adds a directional rim light + top sheen.
//
// Surfaces that reserve screen space (dock, menu bar) never have windows
// behind them, so a wallpaper source is exact there and costs one cached blur.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shell.SnippetHook was folded into Cogl.SnippetHook in recent GNOME releases.
const FRAGMENT_HOOK = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

const DECLARATIONS = `
uniform sampler2D tex;
uniform vec2 size;
uniform float radius;
uniform float thickness;
uniform float refraction;
uniform float chroma;
uniform float rim;
uniform float sheen;
uniform vec2 light_dir;
uniform vec4 tint;

float sd_round_rect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].st;
vec2 p = uv * size - size * 0.5;
vec2 b = size * 0.5;
float r = min(radius, min(b.x, b.y));
float d = sd_round_rect(p, b, r);
float mask = 1.0 - smoothstep(-1.0, 0.5, d);

// Outward surface normal from the SDF gradient.
vec2 g = vec2(sd_round_rect(p + vec2(1.0, 0.0), b, r) - sd_round_rect(p - vec2(1.0, 0.0), b, r),
              sd_round_rect(p + vec2(0.0, 1.0), b, r) - sd_round_rect(p - vec2(0.0, 1.0), b, r));
vec2 n = length(g) > 0.0001 ? normalize(g) : vec2(0.0);

// Lens profile: flat in the middle, strongly curved in the edge band.
float depth = clamp(-d / max(thickness, 1.0), 0.0, 1.0);
float bend = (1.0 - depth) * (1.0 - depth);
vec2 shift = -n * bend * refraction / size;
vec2 split = n * bend * chroma / size;

vec3 col;
col.r = texture2D(tex, clamp(uv + shift + split, 0.0, 1.0)).r;
col.g = texture2D(tex, clamp(uv + shift, 0.0, 1.0)).g;
col.b = texture2D(tex, clamp(uv + shift - split, 0.0, 1.0)).b;

col = mix(col, tint.rgb, tint.a);

// Rim light: bright on the side facing the light, faint on the opposite one.
float band = 1.0 - smoothstep(0.0, 1.6, -d);
float facing = dot(n, light_dir);
float rim_light = band * (0.25 + 0.75 * max(facing, 0.0) + 0.35 * max(-facing, 0.0)) * rim;

// Soft sheen on the upper part of the surface.
float top = clamp(1.0 - uv.y * 2.2, 0.0, 1.0);
float sheen_light = top * top * sheen * 0.12;

col = col + vec3(rim_light + sheen_light) * (1.0 - col);
cogl_color_out = vec4(col * mask, mask);
`;

export const GlassEffect = GObject.registerClass(
class GlassEffect extends Shell.GLSLEffect {
    _init(params = {}) {
        super._init();
        this._params = {
            radius: 18,
            thickness: 16,
            refraction: 14,
            chroma: 1.5,
            rim: 0.55,
            sheen: 1.0,
            lightAngle: 55,
            tint: [0.07, 0.07, 0.09, 0.18],
        };
        this._locations = {};
        for (const name of ['tex', 'size', 'radius', 'thickness', 'refraction',
            'chroma', 'rim', 'sheen', 'light_dir', 'tint'])
            this._locations[name] = this.get_uniform_location(name);
        this.setParams(params);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(FRAGMENT_HOOK, DECLARATIONS, CODE, false);
    }

    setParams(params) {
        Object.assign(this._params, params);
        const p = this._params;
        const l = this._locations;
        const angle = p.lightAngle * Math.PI / 180;
        this.set_uniform_float(l.radius, 1, [p.radius]);
        this.set_uniform_float(l.thickness, 1, [p.thickness]);
        this.set_uniform_float(l.refraction, 1, [p.refraction]);
        this.set_uniform_float(l.chroma, 1, [p.chroma]);
        this.set_uniform_float(l.rim, 1, [p.rim]);
        this.set_uniform_float(l.sheen, 1, [p.sheen]);
        // Screen y grows downwards, so a light from the top-right is (cos, -sin).
        this.set_uniform_float(l.light_dir, 2, [Math.cos(angle), -Math.sin(angle)]);
        this.set_uniform_float(l.tint, 4, p.tint);
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        if (actor)
            this.set_uniform_float(this._locations.size, 2, [actor.width, actor.height]);
        super.vfunc_paint_target(node, paintContext);
    }
});

export function glassParamsFromSettings(settings, radius) {
    const alpha = settings.get_double('glass-tint-opacity');
    const dark = settings.get_boolean('glass-dark');
    const tint = dark ? [0.07, 0.07, 0.09, alpha] : [0.97, 0.97, 0.98, alpha];
    return {
        radius,
        thickness: Math.max(6, radius * 0.9),
        refraction: settings.get_double('glass-refraction'),
        chroma: settings.get_double('glass-chroma'),
        rim: settings.get_double('glass-rim'),
        tint,
    };
}

// A rounded glass pane. Owners must call setStageOrigin() whenever the
// surface moves so the wallpaper clone stays aligned with the real one.
export const GlassSurface = GObject.registerClass(
class GlassSurface extends St.Widget {
    _init({blur = 30, glass = {}} = {}) {
        super._init({clip_to_allocation: true, reactive: false});

        this._wallpaper = new Clutter.Clone({
            source: Main.layoutManager._backgroundGroup,
            reactive: false,
        });
        this._blur = new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: blur,
            brightness: 1.0,
        });
        this._wallpaper.add_effect(this._blur);
        this.add_child(this._wallpaper);

        this._glass = new GlassEffect(glass);
        this.add_effect(this._glass);
    }

    setStageOrigin(x, y) {
        this._wallpaper.set_position(-Math.round(x), -Math.round(y));
    }

    setGlass(params) {
        this._glass.setParams(params);
    }

    setBlur(radius) {
        this._blur.radius = radius;
    }
});
