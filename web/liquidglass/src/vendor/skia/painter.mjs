/** Apache-2.0. Framework-independent surfaces and lenses using production SkSL. */
import {compileGlassEffects, clearMaterialUniforms} from './renderer.mjs';
import {inAppMaterialUniforms} from './material.mjs';
import {createBackdropSampler} from './backdrop.mjs';
import {glassShaderSources} from './shaders.mjs';
import {calmSelectorMaterial, calmBarMaterial, calmMaterialUniforms} from './selector-material.mjs';

/**
 * Compile once, then draw surfaces and lenses over one caller-owned Skia Image.
 * Coordinates and image dimensions are device pixels with a top-left origin.
 * Production shaders are included; optional sources support advanced/custom shader hosts.
 * This object owns its effects and paint; it borrows, and never deletes, the source image.
 */
export function createGlassPainter(kit, sources = glassShaderSources) {
  const effects = compileGlassEffects(kit, sources);
  let paint;
  try { paint = new kit.Paint(); }
  catch (error) { effects.dispose(); throw error; }
  let source = null, disposed = false, sampler=null;
  function checkAlive() { if (disposed) throw new Error('Glass painter disposed'); }
  // The material pass's share of a Calm material (ink-only terms belong to the content pass).
  const assignMaterial=(uniforms,values)=>{for(const[k,v]of Object.entries(values))if(k in uniforms)uniforms[k]=v;return uniforms;};
  // Compose's elementSizeFactor: 0 for chrome up to 56 dp, 1 from 320 dp.
  const sizeFactor=(width,height,density)=>Math.max(0,Math.min(1,(Math.min(width,height)/density-56)/264));
  // Compose's BlurEffect takes a radius; Skia's blur a sigma (Compose's convertRadiusToSigma).
  const sigma=r=>r>0?.57735*r+.5:0;
  // A contact shadow: the caster's rounded rect in black at `alpha`, blurred and moved down (device px).
  function drawShadow(target,s,alpha,clipOut=null){
    if(!(alpha>0))return;
    const p=new kit.Paint();
    try {
      p.setColor(kit.Color4f(0,0,0,alpha));p.setAntiAlias(true);
      if(s.blur>.01)p.setImageFilter(kit.ImageFilter.MakeBlur(sigma(s.blur),sigma(s.blur),kit.TileMode.Decal,null));
      target.save();
      if(clipOut)target.clipRRect(kit.RRectXY(kit.XYWHRect(clipOut.x,clipOut.y,clipOut.width,clipOut.height),clipOut.radius,clipOut.radius),kit.ClipOp.Difference,true);
      target.drawRRect(kit.RRectXY(kit.XYWHRect(s.x,s.y+s.offset,s.width,s.height),s.radius,s.radius),p);
      target.restore();
    } finally {p.delete();}
  }
  // The backdrop with the glass the lens looks through over it, plus rawShare of the raw page,
  // blurred by rawBlur (a Compose radius, device px) as Compose's GlassStyle.rawBlur. With `shadow`,
  // the lens's own contact shadow at its inside share, where the bar does not cover it.
  function composeThrough(canvas,through,rawShare,rawBlur=0,shadow=null) {
    const surface=canvas.makeSurface({width:source.width(),height:source.height(),colorType:kit.ColorType.RGBA_8888,
      alphaType:kit.AlphaType.Premul,colorSpace:kit.ColorSpace.SRGB});
    if(!surface)throw new Error('Could not allocate the selector backdrop');
    const add=new kit.Paint();
    try {
      const target=surface.getCanvas();target.clear(kit.BLACK);target.drawImage(through??source,0,0);
      if(shadow)drawShadow(target,shadow,shadow.alpha*shadow.inside,shadow.bar);
      if(through&&rawShare>.001){
        add.setBlendMode(kit.BlendMode.Plus);add.setAlphaf(rawShare);
        if(rawBlur>.01)add.setImageFilter(kit.ImageFilter.MakeBlur(sigma(rawBlur),sigma(rawBlur),kit.TileMode.Clamp,null));
        target.drawImage(source,0,0,add);
      }
      surface.flush();return surface.makeImageSnapshot();
    } finally {add.delete();surface.delete();}
  }
  // Consumes the temporary backdrop shader; both public drawing paths preserve identical
  // coverage, page coordinates, host canvas state and exception-safe shader lifetime.
  function draw(canvas,uniforms,backdrop,originX,originY) {
    let material;
    try {
      uniforms.uBackdrop=[-originX,-originY,source.width()-originX,source.height()-originY];
      material=effects.shader('material',uniforms,{content:backdrop,field:backdrop});
      paint.setShader(material);canvas.save();
      try {
        canvas.translate(originX,originY);
        canvas.drawRect(kit.XYWHRect(0,0,uniforms.uSize[0]+2*uniforms.uPad,
          uniforms.uSize[1]+2*uniforms.uPad),paint);
      } finally {canvas.restore();}
    } finally {paint.setShader(null);material?.delete();backdrop.delete();}
  }

  return {
    /** Replace after backdrop changes. Keep the image alive until replacement or disposal. */
    setSource(image) {
      checkAlive();
      if (!image || typeof image.makeShaderOptions !== 'function' ||
          typeof image.width !== 'function' || typeof image.height !== 'function' ||
          !(image.width() > 0) || !(image.height() > 0))
        throw new TypeError('Source must be a live, nonempty CanvasKit Image');
      sampler?.reset();source = image;
    },

    /** Draw a rounded in-app material, including its wide tone kernel. Labels stay with the host. */
    drawSurface(canvas,{x,y,width,height,radius=20},options={}) {
      checkAlive();
      if(!source)throw new Error('Call setSource before drawing glass');
      if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)
        throw new RangeError('Surface requires finite position and positive dimensions');
      const pad=2,originX=x-pad,originY=y-pad;
      const uniforms=inAppMaterialUniforms(effects,{...options,width,height,radius,pad});
      sampler??=createBackdropSampler(kit);
      const backdrop=sampler.shader(canvas,source,originX,originY,uniforms.uWideKernel);
      uniforms.uWideStrip=backdrop.strip;
      draw(canvas,uniforms,backdrop.shader,originX,originY);
    },

    /** Draw a clear magnifier, preserving the host canvas transform and clip. */
    drawLens(canvas, {x, y, width, height = width, magnification = 1.25}) {
      checkAlive();
      if (!source) throw new Error('Call setSource before drawing glass');
      if (![x,y,width,height,magnification].every(Number.isFinite) || width <= 0 || height <= 0 ||
          magnification < 1 || magnification > 2.5)
        throw new RangeError('Lens requires finite geometry, positive dimensions and 1–2.5 magnification');
      // The material's local padded coordinates must sample the same global page coordinates
      // that the host drew. A local shader matrix is inverted by Skia during sampling.
      const pad = 2;
      const originX = x - pad, originY = y - pad;
      const uniforms = clearMaterialUniforms(effects, {width, height, pad, magnification});
      const backdrop = source.makeShaderOptions(
        kit.TileMode.Clamp, kit.TileMode.Clamp, kit.FilterMode.Linear, kit.MipmapMode.None,
        kit.Matrix.translated(-originX, -originY),
      );
      draw(canvas,uniforms,backdrop,originX,originY);
    },

    /**
     * Draw a Calm navigation bar's glass with the Compose Calm bar material (GlassTabBarStyle.Calm,
     * its held lift following the selector's `formation`, or for any touch the navigation's `touch`;
     * `clear` for GlassTabBarStyle.CalmClear's clearer bar; `fuse` from accessoryFuse, in device px,
     * for the neck to a free button beside the bar).
     * Device px; `density` is px per dp.
     */
    drawCalmBar(canvas,{x,y,width,height},{dark=true,density=1,formation=0,touch=0,materialize=1,
      reducedTransparency=0,increasedContrast=0,clear=false,fuse=null}={}) {
      checkAlive();
      if(!source)throw new Error('Call setSource before drawing glass');
      if(![x,y,width,height,density,formation].every(Number.isFinite)||width<=0||height<=0||density<=0)
        throw new RangeError('Calm bar requires finite geometry, positive dimensions and density');
      if(fuse&&(fuse.length!==6||!fuse.every(Number.isFinite)))throw new RangeError('fuse must be six finite numbers (accessoryFuse)');
      // The fused outline reaches past the bar to the button: draw over it, and the neck's bow (a
      // quarter of the smoothing) beyond, as Compose's recordPad does.
      const fusing=fuse&&fuse[5]>0;
      const pad=fusing?Math.ceil(Math.max(2,Math.abs(fuse[0])+fuse[2]-width/2,Math.abs(fuse[1])+fuse[3]-height/2)+fuse[5]/4+2):2;
      const originX=x-pad,originY=y-pad;
      const uniforms=clearMaterialUniforms(effects,{width,height,pad,magnification:1});
      assignMaterial(uniforms,calmMaterialUniforms(calmBarMaterial({dark,formation,touch,clear}),density));
      Object.assign(uniforms,{
        uRadii:Array(4).fill(height/2),uRefractBand:.6*height/2,uFormation:0,
        uScale:sizeFactor(width,height,density),uMaterialize:materialize,uFrost:reducedTransparency,uContrast:increasedContrast,
      });
      if(fusing)Object.assign(uniforms,{uFuse:fuse.slice(0,4),uFuseShape:[fuse[4],fuse[5]]});
      sampler??=createBackdropSampler(kit);
      const backdrop=sampler.shader(canvas,source,originX,originY,uniforms.uWideKernel);
      // Compose records the wide strip only for a kernel of at least a pixel (LiquidGlass.kt useWide).
      uniforms.uWideStrip=uniforms.uWideKernel>=1?backdrop.strip:0;
      draw(canvas,uniforms,backdrop.shader,originX,originY);
    },

    /**
     * Draw a navigation selector's deformed body (a CalmSelectorController frame) over the bar
     * at device rect `bar`. `pose` is `controller.render()` in the same device px as `bar`;
     * `formation`, `transit` and `heldTravel` are the controller's. The material is the Compose
     * Calm selector's own (calmSelectorMaterial: the production pill and lens styles, fold and
     * rim mirror). Like Compose, the lens looks through the bar: pass `through`, an image the
     * size of the source holding the backdrop with the bar's glass drawn over it, and a share of
     * the raw backdrop is added on top; without it the lens sees the backdrop alone. `fuse` (from
     * lensFuse, device px) joins a held lens to a free button through a neck; `shadow: false` skips
     * the lens's contact shadow (light Calm's held lens casts one).
     * Labels and selected ink stay with the host.
     */
    drawSelector(canvas,{x,y,width,height},{pose,formation=0,transit=0,heldTravel=0},options={}) {
      checkAlive();
      if(!source)throw new Error('Call setSource before drawing glass');
      if(![x,y,width,height,formation,transit,heldTravel].every(Number.isFinite)||width<=0||height<=0)
        throw new RangeError('Selector requires a finite bar rect, formation, transit and held travel');
      if(!pose||![pose.a,pose.aInv,pose.c,pose.d].every(v=>Array.isArray(v)&&v.length===4&&v.every(Number.isFinite)))
        throw new TypeError('Selector requires a pose from CalmSelectorController.render()');
      const {dark=true,density=1,materialize=1,reducedTransparency=0,increasedContrast=0,through=null,fuse=null,shadow=true}=options;
      if(!Number.isFinite(density)||density<=0)throw new RangeError('Selector density must be positive');
      if(fuse&&(fuse.length!==6||!fuse.every(Number.isFinite)))throw new RangeError('fuse must be six finite numbers (lensFuse)');
      // The body may stand proud of the bar while held and protrude past its ends in transit.
      const mx=height*.6,my=height*.4,nodeW=width+2*mx,nodeH=height+2*my;
      // A neck to a free button (lensFuse) reaches past the node: draw over it, and its bow beyond.
      const fusing=fuse&&fuse[5]>0;
      const pad=fusing?Math.ceil(Math.max(2,Math.abs(fuse[0])+fuse[2]-nodeW/2,Math.abs(fuse[1])+fuse[3]-nodeH/2)+fuse[5]/4+2):2;
      const originX=x-mx-pad,originY=y-my-pad;
      const {values,uFormation}=calmSelectorMaterial({dark,formation,transit,heldTravel});
      const uniforms=clearMaterialUniforms(effects,{width:nodeW,height:nodeH,pad,magnification:1});
      // Pose c is bar-local; the node is centred on the bar, as the shader expects.
      const [cx,cy,bx,by]=pose.c;
      assignMaterial(uniforms,calmMaterialUniforms(values,density));
      Object.assign(uniforms,{
        uFormation,uBodyKind:2,uPoseA:pose.a,uPoseAInv:pose.aInv,uPoseD:pose.d,
        // GlassStyle.bodyBandScale: the lens refracts over this share of the body's own band.
        uPoseC:[cx-width/2,cy-height/2,bx,by],uRefractBand:pose.d[3]*Math.min(Math.max(values.bodyBandScale??1,.25),4),
        uRadii:Array(4).fill(Math.min(nodeW,nodeH)/2),uScale:sizeFactor(nodeW,nodeH,density),
        uMaterialize:materialize,uFrost:reducedTransparency,uContrast:increasedContrast,
      });
      if(fusing)Object.assign(uniforms,{uFuse:fuse.slice(0,4),uFuseShape:[fuse[4],fuse[5]]});
      // GlassStyle.contactShadow on the lens: cast by its body, 0.14 strong (glassShadow), on the page
      // under it and, at its inside share, in what it looks through (light Calm's held lens).
      const castAlpha=shadow?.14*Math.min(Math.max(values.contactShadow??0,0),1):0;
      let cast=null;
      if(castAlpha>0){
        const s=sizeFactor(nodeW,nodeH,density);
        const [a0,a1,a2,a3]=pose.a,[spine,r,scaleX]=pose.d,hx=spine+r*scaleX,hy=r;
        const ex=Math.abs(a0)*hx+Math.abs(a1)*hy,ey=Math.abs(a2)*hx+Math.abs(a3)*hy;
        cast={x:x+cx-ex,y:y+cy-ey,width:2*ex,height:2*ey,radius:Math.min(ex,ey),alpha:castAlpha,
          inside:Math.min(Math.max(values.contactShadowInside??1,0),1),
          blur:((values.contactShadowBlur??-1)>=0?values.contactShadowBlur:18*(.6+.6*s))*density,
          offset:((values.contactShadowOffset??-1)>=0?values.contactShadowOffset:4*(.5+.9*s))*density,
          bar:{x,y,width,height,radius:height/2}};
        drawShadow(canvas,cast,castAlpha);
      }
      sampler??=createBackdropSampler(kit);
      let composed=null;
      try {
        let view=source;
        if(through&&(typeof through.width!=='function'||through.width()!==source.width()||through.height()!==source.height()))
          throw new TypeError('through must be a live image the size of the source');
        if(through||cast){
          composed=composeThrough(canvas,through,values.rawShare,(values.rawBlur??0)*density,cast);view=composed;
        }
        const backdrop=sampler.shader(canvas,view,originX,originY,uniforms.uWideKernel);
        uniforms.uWideStrip=uniforms.uWideKernel>=1?backdrop.strip:0;
        draw(canvas,uniforms,backdrop.shader,originX,originY);
      } finally {
        // The tone buffer was built from the composed image; drop it with the image.
        if(composed){sampler.reset();composed.delete();}
      }
    },

    /**
     * Draw the selected ink inside the selector, as Compose's content pass does: `ink` is an image
     * of the bar's items drawn in their selected appearance on a transparent ground, in device px
     * with its origin at the bar's top-left (the same layout as the ordinary row the host draws on
     * the bar). Only what lies under the selector shows, refracted, colour-split and folded by the
     * same body, map and band as `drawSelector`; draw it right after `drawSelector`. Every item may
     * be in the image: the lens shows each in its selected colour as it passes (as Calm does).
     */
    drawSelectorInk(canvas,{x,y,width,height},{pose,formation=0,transit=0,heldTravel=0},ink,options={}) {
      checkAlive();
      if(![x,y,width,height,formation,transit,heldTravel].every(Number.isFinite)||width<=0||height<=0)
        throw new RangeError('Selector ink requires a finite bar rect, formation, transit and held travel');
      if(!pose||![pose.a,pose.aInv,pose.c,pose.d].every(v=>Array.isArray(v)&&v.length===4&&v.every(Number.isFinite)))
        throw new TypeError('Selector ink requires a pose from CalmSelectorController.render()');
      if(!ink||typeof ink.makeShaderOptions!=='function')throw new TypeError('Selector ink requires a live CanvasKit Image');
      const {dark=true,density=1,materialize=1}=options;
      if(!Number.isFinite(density)||density<=0)throw new RangeError('Selector density must be positive');
      const mx=height*.6,my=height*.4,nodeW=width+2*mx,nodeH=height+2*my,pad=2;
      const originX=x-mx-pad,originY=y-my-pad;
      const {values,uFormation}=calmSelectorMaterial({dark,formation,transit,heldTravel});
      const px=calmMaterialUniforms(values,density);
      const material=clearMaterialUniforms(effects,{width:nodeW,height:nodeH,pad,magnification:1});
      const [cx,cy,bx,by]=pose.c;
      Object.assign(material,px,{
        uFormation,uBodyKind:2,uPoseA:pose.a,uPoseAInv:pose.aInv,uPoseD:pose.d,
        uPoseC:[cx-width/2,cy-height/2,bx,by],uRefractBand:pose.d[3]*Math.min(Math.max(values.bodyBandScale??1,.25),4),
        uRadii:Array(4).fill(Math.min(nodeW,nodeH)/2),uScale:sizeFactor(nodeW,nodeH,density),uMaterialize:materialize,
      });
      // The content pass shares the material's geometry and optics; it emits the ink premultiplied
      // and clipped to the body (uEndpointAlpha 0), to be drawn over the material.
      const uniforms={};
      for(const u of effects.layout('content'))
        uniforms[u.name]=u.name in material?material[u.name]:(u.columns*u.rows===1?0:Array(u.columns*u.rows).fill(0));
      uniforms.uEndpointAlpha=0;uniforms.uInkSplit=px.uInkSplit;uniforms.uHeldInk=px.uHeldInk;
      let shader,content;
      try {
        // The ink's origin is the bar's: in the padded node frame that is (mx + pad, my + pad).
        content=ink.makeShaderOptions(kit.TileMode.Decal,kit.TileMode.Decal,kit.FilterMode.Linear,kit.MipmapMode.None,
          kit.Matrix.translated(mx+pad,my+pad));
        shader=effects.shader('content',uniforms,{content,field:content});
        paint.setShader(shader);canvas.save();
        try {
          canvas.translate(originX,originY);
          canvas.drawRect(kit.XYWHRect(0,0,nodeW+2*pad,nodeH+2*pad),paint);
        } finally {canvas.restore();}
      } finally {paint.setShader(null);shader?.delete();content?.delete();}
    },

    dispose() {
      if (!disposed) {
        disposed = true;
        source = null;
        paint.delete();
        sampler?.dispose();sampler=null;
        effects.dispose();
      }
    },
  };
}
