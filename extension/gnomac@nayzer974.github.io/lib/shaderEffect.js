// GLSLEffect: the base class of every GNOMAC shader.
//
// GNOME Shell up to 50 ships Shell.GLSLEffect. GNOME Shell 51 (Mutter 51)
// removed it, and Clutter.ShaderEffect no longer lets JavaScript set a shader.
// What is left, and enough, is Clutter.OffscreenEffect plus Cogl snippets: the
// same machinery Shell.GLSLEffect was built on. This module gives the same
// small API on top of it, so the shaders do not change:
//
//   buildPipeline()                  override it and call add_glsl_snippet(hook,
//                                    declarations, code, isReplace) from there
//   get_uniform_location(name)
//   set_uniform_float(location, nComponents, values)
//   vfunc_paint_target(node, paintContext)                  (call super last)
//
// On GNOME 50 the native class is used untouched.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const CoglEffect = GObject.registerClass(
class CoglEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._pSnippets = [];
        this._pValues = new Map();     // uniform name -> {n, values}
        this._pDirty = new Set();
        this._pLocations = new Map();
        this._pPipeline = null;
    }

    add_glsl_snippet(hook, declarations, code, isReplace) {
        this._pSnippets.push({hook, declarations, code, isReplace});
    }

    // A "location" is the uniform's name: the real location belongs to the
    // pipeline, which Clutter may replace, so it is looked up at paint time.
    get_uniform_location(name) {
        return name;
    }

    set_uniform_float(name, nComponents, values) {
        this._pValues.set(name, {n: nComponents, values: [...values]});
        this._pDirty.add(name);
    }

    _prepare(pipeline) {
        if (pipeline !== this._pPipeline) {
            this._pPipeline = pipeline;
            this._pLocations.clear();
            this._pSnippets = [];
            this.buildPipeline();
            for (const {hook, declarations, code, isReplace} of this._pSnippets) {
                const snippet = Cogl.Snippet.new(hook, declarations, null);
                if (isReplace)
                    snippet.set_replace(code);
                else
                    snippet.set_post(code);
                pipeline.add_snippet(snippet);
            }
            this._pDirty = new Set(this._pValues.keys());
        }
        for (const name of this._pDirty) {
            let location = this._pLocations.get(name);
            if (location === undefined) {
                location = pipeline.get_uniform_location(name);
                this._pLocations.set(name, location);
            }
            const {n, values} = this._pValues.get(name);
            if (location >= 0)
                pipeline.set_uniform_float(location, n, values.length / n, values);
        }
        this._pDirty.clear();
    }

    vfunc_paint_target(node, paintContext) {
        const pipeline = this.get_pipeline();
        if (pipeline)
            this._prepare(pipeline);
        super.vfunc_paint_target(node, paintContext);
    }
});

// Shell.GLSLEffect asks for `vfunc_build_pipeline`; the adapter turns that
// into the plain buildPipeline() method both bases share.
const NativeEffect = Shell.GLSLEffect
    ? GObject.registerClass(class NativeEffect extends Shell.GLSLEffect {
        vfunc_build_pipeline() {
            this.buildPipeline();
        }
    })
    : null;

export const GLSLEffect = NativeEffect ?? CoglEffect;
export const usingNativeGLSLEffect = !!Shell.GLSLEffect;
