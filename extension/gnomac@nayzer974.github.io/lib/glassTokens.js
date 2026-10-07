// Liquid Glass design tokens: every number that shapes the material or its
// motion lives here (docs/liquid-glass.md). Components never carry their own.

export const TOKENS = {
    // Material
    glassOpacity: 1.0,
    glassBlur: 40,
    glassSaturation: 1.15,
    glassBrightness: 1.0,
    refractionStrength: 14,
    refractionRadius: 0.9,       // lens thickness, as a fraction of the corner radius
    chromaticAberration: 1.5,
    fresnelIntensity: 0.34,
    fresnelPower: 3.2,
    specularIntensity: 1.0,
    specularSharpness: 1.0,
    rimIntensity: 0.55,
    shadowOpacity: 0.35,
    shadowBlur: 30,
    // Motion (milliseconds)
    animationFast: 180,
    animationNormal: 320,
    animationSlow: 520,
    // Materialization: how much stronger the optics are while the glass forms.
    materializeBoost: 1.8,
    materializeScale: 0.97,
    materializeBlurBoost: 1.7,
};

// Quality levels trade optics for speed. `auto` picks one from the settings.
export const QUALITY = {
    low: {blur: 0.55, chroma: 0, fresnel: 0, refraction: 0.6, sheen: 0.6},
    medium: {blur: 0.8, chroma: 0.5, fresnel: 0.6, refraction: 0.85, sheen: 0.85},
    high: {blur: 1, chroma: 1, fresnel: 1, refraction: 1, sheen: 1},
    ultra: {blur: 1.15, chroma: 1.2, fresnel: 1.2, refraction: 1.1, sheen: 1},
};

export const qualityOf = settings => {
    const name = settings.get_string('glass-quality');
    return QUALITY[name] ?? QUALITY.high;
};
