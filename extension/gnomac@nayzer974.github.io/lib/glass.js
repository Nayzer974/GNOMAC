// Liquid Glass material.
//
// RevoShell's Quickshell shader refracts a flat colour rectangle, so its glass
// only looks real thanks to a Hyprland plugin. Here the refraction samples real
// pixels: a GlassSurface holds a blurred copy of what lies behind it (the
// windows, or just the wallpaper) aligned to its stage position, and
// GlassEffect bends that texture near the rounded edges (Snell-like lens
// profile), splits RGB slightly (chromatic dispersion) and adds a directional
// rim light + top sheen.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
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
uniform float saturation;

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

// Tahoe glass makes what is behind it a little more vivid.
float luma = dot(col, vec3(0.299, 0.587, 0.114));
col = clamp(mix(vec3(luma), col, saturation), 0.0, 1.0);
col = mix(col, tint.rgb, tint.a);

// Rim light: a hairline all around, a touch brighter on the side facing the
// light. Kept faint on purpose: a thick or bright rim reads as a cheap white
// border, especially where it piles up in the corners.
float band = 1.0 - smoothstep(0.0, 1.0, -d);
float facing = dot(n, light_dir);
float rim_light = band * (0.22 + 0.18 * max(facing, 0.0)) * rim;

// Soft sheen on the upper part of the surface.
float top = clamp(1.0 - uv.y * 2.2, 0.0, 1.0);
float sheen_light = top * top * sheen * 0.08;

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
            saturation: 1.15,
        };
        this._locations = {};
        for (const name of ['tex', 'size', 'radius', 'thickness', 'refraction',
            'chroma', 'rim', 'sheen', 'light_dir', 'tint', 'saturation'])
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
        this.set_uniform_float(l.saturation, 1, [p.saturation]);
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

// Clear Liquid Glass (Spotlight, menus, banners): barely tinted, more
// refraction and a brighter rim, like macOS Tahoe's "Clear" material.
export function clearGlassParams(settings, radius) {
    const base = glassParamsFromSettings(settings, radius);
    return {
        ...base,
        refraction: base.refraction * 1.3,
        chroma: base.chroma * 1.4,
        sheen: 1.2,
        saturation: 1.25,
        tint: [...base.tint.slice(0, 3), base.tint[3] * 0.45],
    };
}

// A rounded glass pane. Owners must call setStageOrigin() whenever the
// surface moves so the backdrop stays aligned with what is really behind it.
//
// `backdrop: 'wallpaper'` paints our own copy of the primary wallpaper.
// Cloning GNOME's background group is not enough: mutter skips the parts of
// it hidden behind windows, so a clone turns black wherever a window sits.
// `backdrop: 'windows'` clones the whole window group (wallpaper included,
// unculled in clone paints) for surfaces floating above windows such as
// Spotlight. Shell.BlurEffect in BACKGROUND mode cannot be combined with an
// offscreen shader, so the backdrop has to be a real child actor.
//
// The blur runs on a wrapper only as big as the surface plus a margin, which
// keeps it cheap and gives Shell.BlurEffect a sane paint volume.
export const GlassSurface = GObject.registerClass(
class GlassSurface extends St.Widget {
    _init({blur = 30, glass = {}, backdrop = 'wallpaper'} = {}) {
        super._init({clip_to_allocation: true, reactive: false});
        this._margin = Math.max(8, blur * 2);
        this._origin = [0, 0];

        this._wrapper = new Clutter.Actor({clip_to_allocation: true, reactive: false});
        this._blur = new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: blur,
            brightness: 1.0,
        });
        this._wrapper.add_effect(this._blur);
        this.add_child(this._wrapper);

        if (backdrop === 'windows') {
            this._source = new Clutter.Clone({source: global.window_group, reactive: false});
            this._sourceOrigin = [0, 0];
        } else {
            const monitor = Main.layoutManager.primaryMonitor;
            this._source = new Meta.BackgroundGroup();
            this._bgManager = new Background.BackgroundManager({
                container: this._source,
                monitorIndex: Main.layoutManager.primaryIndex,
                controlPosition: false,
            });
            this._sourceOrigin = [monitor.x, monitor.y];
        }
        this._wrapper.add_child(this._source);

        this._glass = new GlassEffect(glass);
        this.add_effect(this._glass);

        this.connect('notify::width', () => this._sync());
        this.connect('notify::height', () => this._sync());
        this.connect('notify::mapped', () => this._sync());
        this.connect('destroy', () => {
            this._bgManager?.destroy();
            this._bgManager = null;
        });
    }

    setStageOrigin(x, y) {
        this._origin = [Math.round(x), Math.round(y)];
        this._sync();
    }

    _sync() {
        // Sizing children before the surface is on stage only yields St
        // warnings; notify::mapped brings us back here once it is.
        if (!this.get_stage() || !Number.isFinite(this.width) || !Number.isFinite(this.height))
            return;
        const m = this._margin;
        const [x, y] = this._origin;
        this._wrapper.set_position(-m, -m);
        this._wrapper.set_size(this.width + 2 * m, this.height + 2 * m);
        this._source.set_position(
            this._sourceOrigin[0] - x + m,
            this._sourceOrigin[1] - y + m);
    }

    setGlass(params) {
        this._glass.setParams(params);
    }

    setBlur(radius) {
        this._blur.radius = radius;
    }
});
