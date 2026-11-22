/** Apache-2.0. In-app material parameters from GlassStyle.inApp / GlassMaterial.
 * This is an adapter to the production shader, not another optical implementation.
 */
import {clearMaterialUniforms} from './renderer.mjs';

const lightOpacity=[[0,.435],[31,.514],[50,.565],[62,.600],[100,.733]];
const darkOpacity=[[0,.416],[29,.439],[50,.451],[62,.510],[86,.655],[100,.737]];
function interpolate(table,t) {
  let i=0;while(i<table.length-2&&table[i+1][0]<=t)i++;
  const [x,a]=table[i],[y,b]=table[i+1];return a+(b-a)*(t-x)/(y-x);
}

/** Lengths are device pixels; density converts the measured dp material constants only.
 * `tint` ([r, g, b, a], sRGB 0..1) is Compose's `Glass.tint(color)`: it replaces the tint colour and
 * its opacity, quantized to 8 bits per channel as Compose's sRGB Color is; the dark lift stays.
 * `light` ([x, y], toward the light, y up negative) is Compose's GlassLight: the default is
 * `GlassLight.Default`, as `Glass.Regular` binds it; [0, -1] is iOS 27's measured overhead light. */
export function inAppMaterialUniforms(effects, {width,height,pad=2,radius=20,density=1,
  dark=false,tintAmount=50,materialize=1,reducedTransparency=0,increasedContrast=0,tint=null,
  light=[-.35,-.94]}) {
  if (![density,tintAmount,materialize,reducedTransparency,increasedContrast].every(Number.isFinite)||
      density<=0||tintAmount<0||tintAmount>100||
      [materialize,reducedTransparency,increasedContrast].some(x=>x<0||x>1)||typeof dark!=='boolean')
    throw new RangeError('Invalid material options: positive density, tint 0..100, preferences 0..1, boolean dark required');
  const lightDir=Array.from(light??[]);
  if(lightDir.length!==2||lightDir.some(x=>!Number.isFinite(x)))
    throw new RangeError('Light requires two finite components');
  const tintColor=tint==null?null:Array.from(tint);
  if(tintColor&&(tintColor.length!==4||tintColor.some(x=>!Number.isFinite(x)||x<0||x>1)))
    throw new RangeError('Tint requires four sRGB components between 0 and 1');
  const radii=typeof radius==='number'?Array(4).fill(radius):Array.from(radius??[]);
  if(radii.length!==4||radii.some(x=>!Number.isFinite(x)||x<0))
    throw new RangeError('Radius requires one or four nonnegative finite pixel values');
  const values=clearMaterialUniforms(effects,{width,height,pad,magnification:1});
  const t=tintAmount/100,limit=Math.min(width,height)/2;
  const r=radii.map(x=>Math.min(x,limit));
  const grey=dark?0:241/255;
  Object.assign(values,{
    uRadii:r,uRefractBand:.6*Math.max(...r),uRefractDepth:14*density,
    uProfile:1,uFormation:0,uHeldLens:0,uHeldMagnification:0,uHeldGlow:1,
    uAberration:.07,uBlur:(.5+1.5*t*t)/.6*density,
    uWideKernel:10*density,uFineShare:.95*Math.pow(1-t,1.5),
    // Compose's sRGB Color.copy quantizes alpha to8 bits; preserve its actual shader input.
    uTint:[grey,grey,grey,Math.round(interpolate(dark?darkOpacity:lightOpacity,tintAmount)*255)/255],
    uLift:dark?35/255:0,uBevel:1.33*density,uBevelPeak:.25,
    uSpecular:.25,uSpecularPow:6,uCounterLight:1,uEdgeLight:0,uLight:lightDir,
    uLegibility:.6,uScale:Math.max(0,Math.min(1,(Math.min(width,height)/density-56)/264)),
    uMaterialize:materialize,uFrost:reducedTransparency,uContrast:increasedContrast,
  });
  if(tintColor)values.uTint=tintColor.map(x=>Math.round(x*255)/255);
  return values;
}
