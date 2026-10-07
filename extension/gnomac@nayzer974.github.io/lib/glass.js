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
import {TOKENS, qualityOf} from './glassTokens.js';
import {adaptive} from './adaptive.js';
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
uniform vec2 pointer;     // pointer in actor pixels, (-1,-1) = none
uniform float glow;        // strength of the pointer highlight
uniform float depth_shade; // soft inner shadow near the edges
uniform float fresnel;         // edge light at grazing angles
uniform float fresnel_power;
uniform float form;            // 0 = the glass is forming, 1 = settled
uniform float form_boost;      // how much stronger the optics are while forming
uniform float debug_mode;        // 0 normal; 1 backdrop 2 refraction 3 fresnel 4 specular 5 rim 6 tint

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
// While the glass forms, lensing, specular and fresnel start strong and settle:
// it materialises instead of fading.
float forming = 1.0 + (1.0 - form) * form_boost;
vec2 shift = -n * bend * refraction * forming / size;
vec2 split = n * bend * chroma * forming / size;

vec3 col;
vec3 backdrop = texture2D(tex, uv).rgb;
col.r = texture2D(tex, clamp(uv + shift + split, 0.0, 1.0)).r;
col.g = texture2D(tex, clamp(uv + shift, 0.0, 1.0)).g;
col.b = texture2D(tex, clamp(uv + shift - split, 0.0, 1.0)).b;

// Tahoe glass makes what is behind it a little more vivid.
float luma = dot(col, vec3(0.299, 0.587, 0.114));
col = clamp(mix(vec3(luma), col, saturation), 0.0, 1.0);
col = mix(col, tint.rgb, tint.a);
vec3 tinted = col;

// Rim light: a hairline all around, a touch brighter on the side facing the
// light. Kept faint on purpose: a thick or bright rim reads as a cheap white
// border, especially where it piles up in the corners.
float band = 1.0 - smoothstep(0.0, 1.0, -d);
float facing = dot(n, light_dir);
float rim_light = band * (0.22 + 0.18 * max(facing, 0.0)) * rim;

// Fresnel: the surface catches more light towards its edges, as glass does at
// grazing angles. Faint, visible only when looking closely.
float fres = pow(1.0 - depth, fresnel_power) * fresnel * forming;

// Soft sheen on the upper part of the surface.
float top = clamp(1.0 - uv.y * 2.2, 0.0, 1.0);
float sheen_light = top * top * sheen * 0.08 * forming;

// Inner shadow: the glass looks thick, the edges darken a touch.
float inner = smoothstep(0.0, max(thickness * 1.6, 8.0), -d);
col *= mix(1.0 - depth_shade, 1.0, inner);

// Pointer highlight: a soft specular bloom that follows the cursor, as on
// macOS widgets and the Dock. Zero when no pointer is over the surface.
float lit = 0.0;
if (pointer.x >= 0.0) {
    float dist = length(uv * size - pointer);
    lit = glow * exp(-dist * dist / (2.0 * 70.0 * 70.0));
}

col = col + vec3(rim_light + sheen_light + fres * 0.30 + lit * 0.14) * (1.0 - col);
int dm = int(debug_mode + 0.5);
if (dm == 1) col = backdrop;
else if (dm == 2) col = vec3(0.5 + 0.5 * (shift.x * size.x) / max(refraction, 1.0), 0.5 + 0.5 * (shift.y * size.y) / max(refraction, 1.0), 0.5);
else if (dm == 3) col = vec3(fres * 2.5);
else if (dm == 4) col = vec3(sheen_light * 6.0 + lit * 0.4);
else if (dm == 5) col = vec3(rim_light * 2.0);
else if (dm == 6) col = tinted;
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
            pointer: [-1, -1],
            glow: 0,
            depthShade: 0,
            fresnel: TOKENS.fresnelIntensity,
            fresnelPower: TOKENS.fresnelPower,
            form: 1,
            formBoost: TOKENS.materializeBoost,
            debug: 0,
        };
        this._locations = {};
        for (const name of ['tex', 'size', 'radius', 'thickness', 'refraction',
            'chroma', 'rim', 'sheen', 'light_dir', 'tint', 'saturation', 'pointer', 'glow', 'depth_shade',
            'fresnel', 'fresnel_power', 'form', 'form_boost', 'debug_mode'])
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
        this.set_uniform_float(l.pointer, 2, p.pointer);
        this.set_uniform_float(l.glow, 1, [p.glow]);
        this.set_uniform_float(l.depth_shade, 1, [p.depthShade]);
        this.set_uniform_float(l.fresnel, 1, [p.fresnel]);
        this.set_uniform_float(l.fresnel_power, 1, [p.fresnelPower]);
        this.set_uniform_float(l.form, 1, [p.form]);
        this.set_uniform_float(l.form_boost, 1, [p.formBoost]);
        this.set_uniform_float(l.debug_mode, 1, [p.debug]);
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
    // macOS Tahoe's Liquid Glass slider: clear glass is barely tinted, tinted
    // glass takes the accent colour; intensity is how strong the tint gets.
    const intensity = settings.get_double('glass-intensity');
    const tinted = settings.get_boolean('glass-tinted');
    const dark = settings.get_boolean('glass-dark');
    const base = tinted ? [0.19, 0.36, 0.86] : (dark ? [0.07, 0.07, 0.09] : [0.97, 0.97, 0.98]);
    const alpha = tinted ? Math.min(0.9, 0.3 + intensity * 0.55) : Math.min(0.85, 0.04 + intensity * 0.5);
    const q = qualityOf(settings);
    const params = {
        radius,
        thickness: Math.max(6, radius * TOKENS.refractionRadius),
        refraction: settings.get_double('glass-refraction') * q.refraction,
        chroma: settings.get_double('glass-chroma') * q.chroma,
        rim: settings.get_double('glass-rim'),
        sheen: TOKENS.specularIntensity * q.sheen,
        fresnel: TOKENS.fresnelIntensity * q.fresnel * settings.get_double('glass-fresnel'),
        fresnelPower: TOKENS.fresnelPower,
        tint: [...base, alpha],
        debug: settings.get_int('glass-debug-mode'),
    };
    // What is behind steers the material (transparent glass on a dark wallpaper
    // stays faint; on a bright one it gains body and a clearer edge).
    return settings.get_boolean('glass-adaptive') ? adaptive.adapt(params) : params;
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
export const liveSurfaces = new Set();

export const GlassSurface = GObject.registerClass(
class GlassSurface extends St.Widget {
    _init({blur = 30, glass = {}, backdrop = 'wallpaper'} = {}) {
        super._init({clip_to_allocation: true, reactive: false});
        this._baseBlur = blur;
        liveSurfaces.add(this);
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
            liveSurfaces.delete(this);
            this._formTimeline?.stop();
            this._bgManager?.destroy();
            this._bgManager = null;
        });
    }

    // The glass forms: lensing, specular and fresnel start strong and settle
    // while the blur eases down and the surface grows from 97 %. Not a fade.
    // `reverse` dissolves it instead (dematerialize). Instant when animations
    // are off (reduced motion).
    materialize({duration = TOKENS.animationNormal, reverse = false, onDone = null, fade = true} = {}) {
        this._formTimeline?.stop();
        const final = reverse ? 0 : 1;
        const apply = f => {
            this._glass.setParams({form: f});
            this._blur.radius = Math.round(this._baseBlur * (1 + (1 - f) * (TOKENS.materializeBlurBoost - 1)));
            const scale = TOKENS.materializeScale + (1 - TOKENS.materializeScale) * f;
            this.set_pivot_point(0.5, 0.5);
            this.set_scale(scale, scale);
            if (fade)
                this.opacity = Math.round(255 * Math.min(1, f * 1.6));
        };
        if (!St.Settings.get().enable_animations || !this.get_stage()) {
            apply(final);
            onDone?.();
            return;
        }
        const timeline = new Clutter.Timeline({actor: this, duration});
        this._formTimeline = timeline;
        timeline.connect('new-frame', () => {
            const t = timeline.get_progress();
            const eased = 1 - (1 - t) ** 3;
            apply(reverse ? 1 - eased : eased);
        });
        timeline.connect('completed', () => {
            this._formTimeline = null;
            apply(final);
            onDone?.();
        });
        apply(reverse ? 1 : 0);
        timeline.start();
    }

    // Debug view of one layer of the material (0 = off).
    setDebugMode(mode) {
        this._glass.setParams({debug: mode});
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

    // The glass blooms where the pointer is, fading in and out. `owner` is
    // the reactive actor that receives the motion; coordinates are local to
    // this surface.
    followPointer(owner, strength = 1) {
        const move = (_a, event) => {
            const [x, y] = event.get_coords();
            const [ok, lx, ly] = this.transform_stage_point(x, y);
            if (ok)
                this._glass.setParams({pointer: [lx, ly], glow: strength});
        };
        owner.connect('motion-event', move);
        owner.connect('enter-event', move);
        owner.connect('leave-event', () => this._glass.setParams({pointer: [-1, -1], glow: 0}));
    }

    setBlur(radius) {
        this._blur.radius = radius;
    }
});
