/** Apache-2.0. Adapts a shared sharp/quarter-blurred page to the production strip contract. */
const source = `uniform shader sharp;
uniform shader wide;
uniform float2 origin;
uniform float strip;
uniform float threshold;
half4 main(float2 p) {
  if(p.y>=threshold) return wide.eval(float2(p.x,p.y-strip)*4.0+origin);
  return sharp.eval(p+origin);
}`;

export function createBackdropSampler(kit) {
  const effect=kit.RuntimeEffect.Make(source);
  if(!effect)throw new Error('Could not compile backdrop coordinate adapter');
  let cache=null;
  function reset() {cache?.image.delete();cache=null;}
  return {
    reset,
    /** Returned shader belongs to the caller; one blurred source is cached for this canvas. */
    shader(canvas,image,originX,originY,sigma) {
      // No wide kernel: the shader never reads the strip (uWideStrip 0), so build no blurred
      // tone buffer at all; the sharp page stands in for both children.
      if(!(sigma>=1)) {
        const sharp=image.makeShaderOptions(kit.TileMode.Clamp,kit.TileMode.Clamp,
          kit.FilterMode.Linear,kit.MipmapMode.None);
        try {
          const threshold=Math.max(1,image.height()-originY+1);
          const strip=threshold+Math.max(0,originY/4)+1;
          return {strip,shader:effect.makeShaderWithChildren(new Float32Array([originX,originY,strip,threshold]),[sharp,sharp])};
        } finally {sharp.delete();}
      }
      // getCanvas() returns fresh JS wrappers around the same native canvas. Comparing only
      // wrapper identity would silently rebuild this blur on every animation frame.
      const sameCanvas=cache&&(cache.canvas===canvas||cache.canvas.isAliasOf?.(canvas));
      if(!cache||cache.source!==image||!sameCanvas||cache.sigma!==sigma) {
        reset();
        const width=Math.ceil(image.width()/4),height=Math.ceil(image.height()/4);
        const surface=canvas.makeSurface({width,height,colorType:kit.ColorType.RGBA_8888,
          alphaType:kit.AlphaType.Premul,colorSpace:kit.ColorSpace.SRGB});
        if(!surface)throw new Error('Could not allocate the glass tone buffer');
        let paint,filter,sourceShader;
        try {
          paint=new kit.Paint();filter=kit.ImageFilter.MakeBlur(sigma,sigma,kit.TileMode.Clamp,null);
          const target=surface.getCanvas();target.clear(kit.TRANSPARENT);target.scale(.25,.25);
          // A bounded image draw loses coverage for sources smaller than the blur support,
          // especially at quarter resolution. Extend the opaque page before filtering, so
          // neither Gaussian sampling nor a fractional last texel can introduce transparent black.
          sourceShader=image.makeShaderOptions(kit.TileMode.Clamp,kit.TileMode.Clamp,
            kit.FilterMode.Linear,kit.MipmapMode.None);
          paint.setShader(sourceShader);paint.setImageFilter(filter);target.drawPaint(paint);surface.flush();
          cache={source:image,canvas,sigma,image:surface.makeImageSnapshot()};
        } finally {paint?.delete();filter?.delete();sourceShader?.delete();surface.delete();}
      }
      const sharp=image.makeShaderOptions(kit.TileMode.Clamp,kit.TileMode.Clamp,
        kit.FilterMode.Linear,kit.MipmapMode.None);
      let wide;
      try {
        wide=cache.image.makeShaderOptions(kit.TileMode.Clamp,kit.TileMode.Clamp,
          kit.FilterMode.Linear,kit.MipmapMode.None,kit.Matrix.scaled(4,4));
        // No sharp coordinate can enter the virtual wide strip, including partial panels.
        const threshold=Math.max(1,image.height()-originY+1);
        const strip=threshold+Math.max(0,originY/4)+1;
        return {strip,shader:effect.makeShaderWithChildren(new Float32Array([originX,originY,strip,threshold]),[sharp,wide])};
      } finally {sharp.delete();wide?.delete();}
    },
    dispose(){reset();effect.delete();},
  };
}
