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
import GLib from 'gi://GLib';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import {TOKENS, qualityOf} from './glassTokens.js';
import {adaptive} from './adaptive.js';
import {glassPerformance} from './glassPerformance.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {GLSLEffect} from './shaderEffect.js';

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
// Up to eight regions (x, y, w, h in actor pixels) drawn as ONE piece of glass.
// A region of zero width is unused; with none, the whole actor is the glass.
uniform vec4 regs[8];
uniform float reg_radius[8];
uniform float merge_k;           // smooth-union width: 0 = hard union
uniform float brightness;        // overall brightness of the material (1 = unchanged)
// Per-region material, used when the surface has regions:
//   mat_tint     rgba tint
//   mat_a        saturation, brightness, fresnel, specular
//   mat_b        refraction, edge light, opacity, materialization intensity
uniform vec4 mat_tint[8];
uniform vec4 mat_a[8];
uniform vec4 mat_b[8];

vec4 g_tint;
vec4 g_a;
vec4 g_b;

float sd_round_rect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float region_sd(vec2 px, vec4 reg, float rad) {
    vec2 h = reg.zw * 0.5;
    return sd_round_rect(px - reg.xy - h, h, min(rad, min(h.x, h.y)));
}

float smin_k(float a, float b, float k) {
    if (k <= 0.0)
        return min(a, b);
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

// The material at a pixel: the surface's own, or, with regions, a blend of the
// regions' materials weighted by closeness (inside a region it is that region's
// exactly; across a join it glides from one to the other).
void material_at(vec2 px) {
    g_tint = tint;
    g_a = vec4(saturation, brightness, fresnel, sheen);
    g_b = vec4(refraction, rim, 1.0, 1.0);
    if (regs[0].z <= 0.0)
        return;
    float wsum = 0.0;
    vec4 t = vec4(0.0);
    vec4 a = vec4(0.0);
    vec4 b = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        if (regs[i].z > 0.0) {
            float w = exp(-max(region_sd(px, regs[i], reg_radius[i]), 0.0) / 6.0) + 0.0001;
            t += w * mat_tint[i];
            a += w * mat_a[i];
            b += w * mat_b[i];
            wsum += w;
        }
    }
    g_tint = t / wsum;
    g_a = a / wsum;
    g_b = b / wsum;
}

float scene_sd(vec2 px) {
    if (regs[0].z <= 0.0)
        return sd_round_rect(px - size * 0.5, size * 0.5, min(radius, min(size.x, size.y) * 0.5));
    float d = region_sd(px, regs[0], reg_radius[0]);
    for (int i = 1; i < 8; i++) {
        if (regs[i].z > 0.0)
            d = smin_k(d, region_sd(px, regs[i], reg_radius[i]), merge_k);
    }
    return d;
}
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].st;
vec2 px = uv * size;
float d = scene_sd(px);
float mask = 1.0 - smoothstep(-1.0, 0.5, d);
cogl_color_out = vec4(0.0);
material_at(px);
// Outside the glass (the gaps of a group, the corners) nothing else is computed.
if (d < 1.5) {

// Outward surface normal from the SDF gradient (forward differences).
vec2 g = vec2(scene_sd(px + vec2(1.0, 0.0)) - d, scene_sd(px + vec2(0.0, 1.0)) - d);
vec2 n = length(g) > 0.0001 ? normalize(g) : vec2(0.0);

// The bezel is a convex lens: flat in the middle, and over the rim width the
// surface curves like a quarter circle, so the lens is weak just inside and
// bends light very strongly at the outer edge (Snell's refraction through a
// circular profile). din is the distance inside the edge, in pixels.
float rim_w = max(thickness, 2.0);
float din = max(-d, 0.0);
float depth = clamp(din / rim_w, 0.0, 1.0);
float xr = 1.0 - depth;
// Circular profile 1 - sqrt(1 - x^2), regularised so its slope at the very
// edge stays finite (no singular pixel row): same endpoints, softer tip.
float soft_e = 2.0 / rim_w;
float prof = (sqrt(1.0 + soft_e) - sqrt(max(1.0 - xr * xr + soft_e, 0.0))) / (sqrt(1.0 + soft_e) - sqrt(soft_e));
// Dispersion has its own, narrower profile (outer half of the rim only).
float x2 = 1.0 - clamp(din / (rim_w * 0.5), 0.0, 1.0);
float prof2 = 1.0 - sqrt(max(1.0 - x2 * x2, 0.0));
// While the glass forms, lensing, specular and fresnel start strong and settle:
// it materialises instead of fading.
float forming = 1.0 + (1.0 - form) * form_boost * g_b.w;
vec2 shift = -n * prof * g_b.x * forming / size;
vec2 split = n * prof2 * chroma * forming / size;

vec3 col;
vec3 backdrop = texture2D(tex, uv).rgb;
col.r = texture2D(tex, clamp(uv + shift + split, 0.0, 1.0)).r;
col.g = texture2D(tex, clamp(uv + shift, 0.0, 1.0)).g;
col.b = texture2D(tex, clamp(uv + shift - split, 0.0, 1.0)).b;
// Where the lens compresses the background hardest, a few extra taps soften
// what would otherwise alias into a stripe.
if (prof > 0.2) {
    vec2 o = n * 1.4 * prof / size;
    vec2 t = vec2(-n.y, n.x) * 1.4 * prof / size;
    vec3 soft = texture2D(tex, clamp(uv + shift + o, 0.0, 1.0)).rgb +
                texture2D(tex, clamp(uv + shift - o, 0.0, 1.0)).rgb +
                texture2D(tex, clamp(uv + shift + t, 0.0, 1.0)).rgb +
                texture2D(tex, clamp(uv + shift - t, 0.0, 1.0)).rgb;
    col = mix(col, soft * 0.25, 0.45 * smoothstep(0.2, 0.7, prof));
}

// Tahoe glass makes what is behind it a little more vivid.
float luma = dot(col, vec3(0.299, 0.587, 0.114));
col = clamp(mix(vec3(luma), col, g_a.x), 0.0, 1.0);
col = mix(col, g_tint.rgb, g_tint.a);
col = clamp(col * g_a.y, 0.0, 1.0);
vec3 tinted = col;

// Rim light: a hairline all around, a touch brighter on the side facing the
// light. Kept faint on purpose: a thick or bright rim reads as a cheap white
// border, especially where it piles up in the corners.
// Two lobes, as on a real bevel: a bright one where the edge faces the light
// and a fainter one on the opposite side (light that went through the glass).
float band = 1.0 - smoothstep(0.0, 1.3, din);
float lobe1 = pow(max(dot(n, light_dir), 0.0), 2.0);
float lobe2 = pow(max(dot(n, -light_dir), 0.0), 2.0) * 0.5;
float rim_light = band * (0.12 + 0.42 * (lobe1 + lobe2)) * g_b.y;
// A broad, very faint inset glow along the bevel on the lit side.
float inset_glow = exp(-din / max(rim_w * 0.4, 3.0)) * 0.05 * (lobe1 + 0.25);

// Fresnel: the surface catches more light towards its edges, as glass does at
// grazing angles. Faint, visible only when looking closely.
float fres = pow(1.0 - depth, fresnel_power) * g_a.z * forming;

// Soft sheen on the upper part of the surface.
float top = clamp(1.0 - uv.y * 2.2, 0.0, 1.0);
float sheen_light = top * top * g_a.w * 0.08 * forming;

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

col = col + vec3(rim_light + inset_glow + sheen_light + fres * 0.30 + lit * 0.14) * (1.0 - col);
int dm = int(debug_mode + 0.5);
if (dm == 1) col = backdrop;
else if (dm == 2) col = vec3(0.5 + 0.5 * (shift.x * size.x) / max(g_b.x, 1.0), 0.5 + 0.5 * (shift.y * size.y) / max(g_b.x, 1.0), 0.5);
else if (dm == 3) col = vec3(fres * 2.5);
else if (dm == 4) col = vec3(sheen_light * 6.0 + lit * 0.4);
else if (dm == 5) col = vec3(rim_light * 2.0);
else if (dm == 6) col = tinted;
float alpha = mask * g_b.z;
cogl_color_out = vec4(col * alpha, alpha);
}
`;

export const GlassEffect = GObject.registerClass(
class GlassEffect extends GLSLEffect {
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
            regions: [],
            regionRadii: [],
            merge: 0,
            brightness: 1,
            materials: [],
        };
        this._locations = {};
        for (const name of ['tex', 'size', 'radius', 'thickness', 'refraction',
            'chroma', 'rim', 'sheen', 'light_dir', 'tint', 'saturation', 'pointer', 'glow', 'depth_shade',
            'fresnel', 'fresnel_power', 'form', 'form_boost', 'debug_mode',
            'regs', 'reg_radius', 'merge_k', 'brightness', 'mat_tint', 'mat_a', 'mat_b'])
            this._locations[name] = this.get_uniform_location(name);
        this.setParams(params);
    }

    buildPipeline() {
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
        const regs = [];
        const radii = [];
        for (let i = 0; i < 8; i++) {
            regs.push(...(p.regions[i] ?? [0, 0, 0, 0]));
            radii.push(p.regionRadii[i] ?? 0);
        }
        this.set_uniform_float(l.regs, 4, regs);
        this.set_uniform_float(l.reg_radius, 1, radii);
        this.set_uniform_float(l.merge_k, 1, [p.merge]);
        this.set_uniform_float(l.brightness, 1, [p.brightness]);
        if (p.materials.length) {
            const tints = [];
            const as = [];
            const bs = [];
            for (let i = 0; i < 8; i++) {
                const m = p.materials[i] ?? p.materials[0];
                tints.push(...m.tint);
                as.push(m.saturation, m.brightness, m.fresnel, m.specular);
                bs.push(m.refraction, m.edgeLight, m.opacity, m.materializationIntensity);
            }
            this.set_uniform_float(l.mat_tint, 4, tints);
            this.set_uniform_float(l.mat_a, 4, as);
            this.set_uniform_float(l.mat_b, 4, bs);
        }
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

const EASINGS = {
    'out-cubic': t => 1 - (1 - t) ** 3,
    'out-quad': t => 1 - (1 - t) ** 2,
    'in-out': t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    smooth: t => t * t * (3 - 2 * t),
    linear: t => t,
};

export const GlassSurface = GObject.registerClass(
class GlassSurface extends St.Widget {
    // `adaptiveLocal`: the material also follows the brightness of the part of
    // the wallpaper right behind this surface (see sampleBackdrop()).
    _init({blur = 30, glass = {}, backdrop = 'wallpaper', adaptiveLocal = false} = {}) {
        super._init({clip_to_allocation: true, reactive: false});
        this._baseBlur = blur;
        this._backdropKind = backdrop;
        this._adaptiveLocal = adaptiveLocal;
        this._userParams = {...glass};
        this._localTweak = null;
        this._lastSample = {x: -1e6, y: -1e6, t: 0};
        this._perf = glassPerformance.scale;
        this._perfOff = glassPerformance.connect((_level, scale) => this._applyPerf(scale));
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
            this._perfOff?.();
            this._formTimeline?.stop();
            this._morphTimeline?.stop();
            this._bgManager?.destroy();
            this._bgManager = null;
        });
    }

    // Where the glass forms from, in surface-local fractions (the pivot of the
    // scale): the centre, the pointer, the middle of the parent, the middle of
    // another actor (`source`, e.g. the button that opened it) or a stage point.
    _originFraction(origin, source, point) {
        if (origin === 'center' || !this.get_stage() || this.width < 1 || this.height < 1)
            return [0.5, 0.5];
        let stage = null;
        if (origin === 'cursor') {
            const [x, y] = global.get_pointer();
            stage = [x, y];
        } else if (origin === 'parent' && this.get_parent()) {
            const [x, y] = this.get_parent().get_transformed_position();
            stage = [x + this.get_parent().width / 2, y + this.get_parent().height / 2];
        } else if (origin === 'source' && source?.get_stage?.()) {
            const [x, y] = source.get_transformed_position();
            const [w, h] = source.get_transformed_size();
            stage = [x + w / 2, y + h / 2];
        } else if (origin === 'explicit' && point) {
            stage = point;
        }
        if (!stage)
            return [0.5, 0.5];
        const [ok, lx, ly] = this.transform_stage_point(stage[0], stage[1]);
        if (!ok)
            return [0.5, 0.5];
        // A point far outside the surface would throw the scale far away.
        return [Math.min(1.2, Math.max(-0.2, lx / this.width)), Math.min(1.2, Math.max(-0.2, ly / this.height))];
    }

    // The glass forms: lensing, specular and fresnel start strong and settle
    // while the blur eases down and the surface grows from ~97 %. Not a fade.
    // Options: origin ('center' | 'cursor' | 'parent' | 'source' | 'explicit'),
    // source (actor) / point ([x, y] on the stage), duration, intensity (1 =
    // normal), easing ('out-cubic' | 'out-quad' | 'in-out' | 'linear'), mode
    // ('form' | 'dissolve'; `reverse: true` is the old spelling of dissolve),
    // fade, onDone. Instant when animations are off (reduced motion).
    materialize({duration = TOKENS.animationNormal, reverse = false, onDone = null, fade = true,
        origin = 'center', source = null, point = null, intensity = 1, easing = 'out-cubic', mode = 'form'} = {}) {
        this._formTimeline?.stop();
        reverse = reverse || mode === 'dissolve';
        const final = reverse ? 0 : 1;
        const ease = EASINGS[easing] ?? EASINGS['out-cubic'];
        const [px, py] = this._originFraction(origin, source, point);
        // From a point the surface grows a little more, so the origin reads.
        const from = 1 - (1 - TOKENS.materializeScale) * (origin === 'center' ? 1 : 2.5) * intensity;
        const boost = TOKENS.materializeBoost * intensity;
        const blurBoost = 1 + (TOKENS.materializeBlurBoost - 1) * intensity;
        this.set_pivot_point(px, py);
        const apply = f => {
            this._glass.setParams({form: f, formBoost: boost});
            this._blur.radius = Math.round(this._baseBlur * this._perf.blur * (1 + (1 - f) * (blurBoost - 1)));
            const scale = from + (1 - from) * f;
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
            const eased = ease(timeline.get_progress());
            apply(reverse ? 1 - eased : eased);
        });
        timeline.connect('completed', () => {
            this._formTimeline = null;
            apply(final);
            if (final === 1)
                this.set_pivot_point(0.5, 0.5);
            onDone?.();
        });
        apply(reverse ? 1 : 0);
        timeline.start();
    }

    // Glass-to-glass transition: the SAME surface changes shape and material,
    // nothing is hidden, shown, destroyed or created. `from` and `to` are
    // objects with any of x, y, width, height, radius, opacity (0-255), blur,
    // brightness, saturation, tint ([r, g, b, a]), refraction, fresnel,
    // specular, shadow, materialization (0 forming .. 1 settled), or an actor
    // (its place on the screen becomes x, y, width, height); `from` null
    // starts from the current values. Options: duration, easing ('smooth' is
    // 'in-out'), materialTransition (the optics of the glass swell through the
    // middle of the move, as if the glass were flowing), onDone.
    morph(from, to, {duration = TOKENS.animationNormal, easing = 'out-cubic', materialTransition = false,
        onDone = null} = {}) {
        this._morphTimeline?.stop();
        const p = this._glass._params;
        const local = value => (value instanceof Clutter.Actor ? this._boundsOf(value) : value);
        from = local(from);
        to = local(to);
        const now = {
            x: this.x, y: this.y, width: this.width, height: this.height,
            radius: p.radius, opacity: this.opacity, blur: this._baseBlur,
            refraction: p.refraction, fresnel: p.fresnel, specular: p.sheen, shadow: p.depthShade,
            brightness: p.brightness, saturation: p.saturation, tint: [...p.tint], materialization: p.form,
        };
        const start = {...now, ...(from ?? {})};
        const end = {...now, ...to};
        const keys = Object.keys(to).filter(k => k in now);
        const ease = EASINGS[easing] ?? EASINGS['out-cubic'];
        const lerp = (a, b, f) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * f) : a + (b - a) * f);
        const apply = (f, progress) => {
            const v = {};
            for (const k of keys)
                v[k] = lerp(start[k], end[k], f);
            if ('x' in v || 'y' in v)
                this.set_position(Math.round(v.x ?? this.x), Math.round(v.y ?? this.y));
            if ('width' in v || 'height' in v)
                this.set_size(Math.round(v.width ?? this.width), Math.round(v.height ?? this.height));
            if ('opacity' in v)
                this.opacity = Math.round(v.opacity);
            if ('blur' in v) {
                this._baseBlur = Math.round(v.blur);
                this._blur.radius = Math.round(this._baseBlur * this._perf.blur);
            }
            const glass = {};
            for (const [key, param] of [['radius', 'radius'], ['refraction', 'refraction'], ['fresnel', 'fresnel'],
                ['specular', 'sheen'], ['shadow', 'depthShade'], ['brightness', 'brightness'],
                ['saturation', 'saturation'], ['tint', 'tint'], ['materialization', 'form']]) {
                if (key in v)
                    glass[param] = v[key];
            }
            Object.assign(this._userParams, glass);
            // The glass swells (more lensing and light) in the middle of the
            // move and settles at the end: one material changing shape.
            const swell = materialTransition ? Math.sin(Math.PI * progress) : 0;
            this._glass.setParams({...this._buildParams(), form: 1 - 0.6 * swell});
        };
        if (!St.Settings.get().enable_animations || !this.get_stage()) {
            apply(1, 1);
            this._pushGlass();
            onDone?.();
            return;
        }
        const timeline = new Clutter.Timeline({actor: this, duration});
        this._morphTimeline = timeline;
        timeline.connect('new-frame', () => apply(ease(timeline.get_progress()), timeline.get_progress()));
        timeline.connect('completed', () => {
            this._morphTimeline = null;
            apply(1, 1);
            this._pushGlass();
            onDone?.();
        });
        apply(0, 0);
        timeline.start();
    }

    // An actor's place in this surface's parent: x, y, width, height.
    _boundsOf(actor) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const parent = this.get_parent();
        if (parent) {
            const [ok, lx, ly] = parent.transform_stage_point(x, y);
            if (ok)
                return {x: lx, y: ly, width: w, height: h};
        }
        return {x, y, width: w, height: h};
    }

    // What is right behind the surface (or `bounds`, in stage pixels): mean
    // luminance and saturation, dominant colour and contrast, taken from the
    // wallpaper thumbnail. Cached and cheap; windows are not part of it.
    sampleBackdrop(bounds = null) {
        const [x, y] = this.get_transformed_position();
        return adaptive.sample(bounds ?? {x, y, width: this.width, height: this.height});
    }

    // Debug view of one layer of the material (0 = off).
    setDebugMode(mode) {
        this._glass.setParams({debug: mode});
    }

    setStageOrigin(x, y) {
        this._origin = [Math.round(x), Math.round(y)];
        this._sync();
        this._adaptLocally();
    }

    // The material follows the wallpaper right behind it: a small correction on
    // top of the global one, at most every 250 ms and only when the surface has
    // moved far enough to see something else.
    _adaptLocally() {
        if (!this._adaptiveLocal || this._backdropKind !== 'wallpaper' && this._backdropKind !== 'windows' ||
            !this.get_stage() || this.width < 4)
            return;
        const [x, y] = this._origin;
        const now = GLib.get_monotonic_time() / 1000;
        const last = this._lastSample;
        // How often the backdrop is re-read depends on the quality level (0 = never).
        const every = this._perf.backdropMs;
        if (!every || now - last.t < every || Math.abs(x - last.x) + Math.abs(y - last.y) < 24)
            return;
        this._lastSample = {x, y, t: now};
        const local = adaptive.sample({x, y, width: this.width, height: this.height});
        const delta = adaptive.localDelta(local);
        if (Math.abs(delta - (this._localTweak ?? 0)) < 0.03)
            return;
        this._localTweak = delta;
        this._pushGlass();
    }

    // The owner's parameters, nudged by the local brightness. Containers add
    // the per-region materials on top (see GlassContainer._buildParams).
    _pushGlass() {
        this._glass.setParams(this._buildParams());
    }

    // The quality level chosen by the performance manager: the optics are
    // eased and the blur narrowed, relative to what the user's setting gave.
    _applyPerf(scale) {
        this._perf = scale;
        if (!this._formTimeline && !this._morphTimeline)
            this._blur.radius = Math.round(this._baseBlur * scale.blur);
        this._pushGlass();
    }

    _buildParams() {
        const params = {...this._userParams};
        const k = this._perf;
        for (const [key, factor] of [['refraction', k.refraction], ['chroma', k.chroma], ['fresnel', k.fresnel],
            ['sheen', k.sheen]]) {
            if (params[key] !== undefined)
                params[key] *= factor;
        }
        const d = this._localTweak;
        if (d && params.tint) {
            const [r, g, b, a] = params.tint;
            params.tint = [r, g, b, Math.min(0.9, Math.max(0, a * (1 + 0.35 * d)))];
            params.rim = (params.rim ?? this._glass._params.rim) * (1 + 0.3 * d);
        }
        return params;
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
        Object.assign(this._userParams, params);
        this._pushGlass();
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
