// The printed caption and the moving paper share one parcel. Reserve the same
// narrow strip in both layouts, including when the building lies folded flat.
export function parcelCaption(site,width,depth){
  if(!site.sourceLabel||site.usage!=='dedicated-candidate')return null;
  const font=Math.min(3.25,(depth-2)/[...site.label].length),band=font+1.6;
  return font>=2.4&&width>=3*band?{font,band}:null;
}
