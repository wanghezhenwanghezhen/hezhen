import * as THREE from 'three';
import { ISLAND_INKS } from './island-palette.js';
import { printedLandmarks } from './city-print-plates.js';
import { boardRoadGlyph } from './island-road-glyphs.js';

const colors=Object.fromEntries(Object.entries(ISLAND_INKS).map(([id,g])=>[id,g.colors.map(s=>[1,3,5].map(k=>parseInt(s.slice(k,k+2),16)))]));
const clamp=x=>Math.max(0,Math.min(1,x));
const tables=new Map();
const buildingThemes=['peach','lilac','mint','sky','rose'];
const paperWall={peach:'134',lilac:'067',mint:'102',sky:'066',rose:'021',foliage:'102',flower:'068',street:'065'};

function chooseInk(r,g,b,theme) {
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),sat=(hi-lo)/Math.max(1,hi);
  const l=.24*r+.56*g+.2*b;
  if(hi<65)return '004';
  if(sat<.12) return l>175 ? (l>222?'078':paperWall[theme]) : (l>100?'082':'004');
  const hue=(hi===r?(g-b)/(hi-lo):hi===g?2+(b-r)/(hi-lo):4+(r-g)/(hi-lo))*60;
  const h=(hue+360)%360;
  if(h<17||h>342)return l>180?'021':l<112?'131':'120';
  if(h<49){
    if(l<110) return '019';
    if(sat<.42&&l>150)return paperWall[theme];
    return h<29?'129':l>176?'065':'043';
  }
  if(h<73)return sat>.38?'013':'108';
  if(h<154)return theme==='flower'?'151':l<85?'150':theme==='foliage'?'022':'024';
  if(h<192)return l>157?'028':'098';
  if(h<253)return l<85?'004':l>182?'146':'132';
  if(h<300)return l<95?'164':'185';
  return l<120?'182':'160';
}
function table(theme) {
  if(tables.has(theme))return tables.get(theme);
  const result=new Uint8Array(32*32*32*3);
  for(let r=0;r<32;r++)for(let g=0;g<32;g++)for(let b=0;b<32;b++){
    const R=r*255/31,G=g*255/31,B=b*255/31,key=((r*32+g)*32+b)*3;
    const id=chooseInk(R,G,B,theme),swatch=colors[id];
    const t=clamp((.24*R+.56*G+.2*B-34)/195),a=t<.5?2:1,c=t<.5?1:0,f=t<.5?2*t:2*t-1;
    for(let k=0;k<3;k++)result[key+k]=Math.round(swatch[a][k]*(1-f)+swatch[c][k]*f);
  }
  tables.set(theme,result);return result;
}
function mapped(data,i,lut) {
  const R=data[i],G=data[i+1],B=data[i+2],idx=(((R>>3)*32+(G>>3))*32+(B>>3))*3;
  // Keep fine paper/printed detail below the quantized color-routing resolution.
  const detail=.23*((R&7)+(G&7)+(B&7)-10.5);
  data[i]=lut[idx]+detail;data[i+1]=lut[idx+1]+detail;data[i+2]=lut[idx+2]+detail;
}
function styledCanvas(image,profile,cellStyle) {
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0);
  const pix=g.getImageData(0,0,canvas.width,canvas.height),data=pix.data,fallback=table(profile);
  for(let y=0;y<canvas.height;y++) {
    let lut=fallback;for(let x=0;x<canvas.width;x++) {
      if(cellStyle&&!(x%128))lut=table(cellStyle[(y>>7)*(canvas.width>>7)+(x>>7)]||profile);
      const i=4*(y*canvas.width+x);if(data[i+3])mapped(data,i,lut);
    }
  }
  g.putImageData(pix,0,0);return canvas;
}
function themeFor(name) {
  if(/blossom|flower|orchard/.test(name))return 'flower';
  if(/forest|grove|hill|garden|meadow|pine/.test(name))return 'foliage';
  let h=13;for(const c of name)h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return buildingThemes[h%buildingThemes.length];
}
const landmarkProfiles=printedLandmarks.flatMap((kit,index)=>kit.panels.map(()=>buildingThemes[index%buildingThemes.length]));
export function tintIslandStreetAtlas(texture,variantKeys) {
  const profiles=variantKeys.flatMap(k=>{const t=k.includes('blue_purple')?'flower':/tree|gp1080/.test(k)?'foliage':'street';return [t,t];});
  texture.image=styledCanvas(texture.image,'street',profiles);texture.needsUpdate=true;return texture;
}
function stylePrototypes(assets) {
  const get=assets.getTilePrototype.bind(assets),styled=new Map(),geomCache=new WeakMap(),matCache=new WeakMap();
  let styledMeshes=0,printedAtlas=0;
  function geom(geometry,theme) {
    const src=geometry.attributes.color;if(!src)return geometry;
    let per=geomCache.get(geometry);if(!per)geomCache.set(geometry,per=new Map());
    if(per.has(theme))return per.get(theme);
    const result=geometry.clone(),c=new THREE.Color(),lut=table(theme),packed=new Uint8ClampedArray(3),dst=new Float32Array(src.count*3);
    for(let i=0;i<src.count;i++){
      c.setRGB(src.getX(i),src.getY(i),src.getZ(i)).convertLinearToSRGB();
      packed[0]=Math.round(255*c.r);packed[1]=Math.round(255*c.g);packed[2]=Math.round(255*c.b);mapped(packed,0,lut);
      c.setRGB(packed[0]/255,packed[1]/255,packed[2]/255).convertSRGBToLinear();c.toArray(dst,3*i);
    }
    result.setAttribute('color',new THREE.BufferAttribute(dst,3));per.set(theme,result);return result;
  }
  function material(m) {
    if(!m?.map || m.map.name!=='city-landmark-ink')return m;
    if(matCache.has(m))return matCache.get(m);
    const result=m.clone(),atlas=new THREE.CanvasTexture(styledCanvas(m.map.image,'lilac',landmarkProfiles));atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=m.map.anisotropy;atlas.name='city-island-landmark-ink';result.map=atlas;
    matCache.set(m,result);printedAtlas++;return result;
  }
  assets.getTilePrototype=id=>{
    if(styled.has(id))return styled.get(id);
    const previous=get(id),tile=previous.clone(true),theme=themeFor(id);
    tile.traverse(o=>{
      if(!o.isMesh||/^base/i.test(o.name))return;
      const old=Array.isArray(o.material)?o.material:[o.material];
      if(old.some(m=>m?.map?.name==='city-landmark-ink'))o.material=Array.isArray(o.material)?old.map(material):material(old[0]);
      else o.geometry=geom(o.geometry,theme);
      styledMeshes++;
    });
    styled.set(id,tile);return tile;
  };
  for(const id of assets.modelIds)assets.getTilePrototype(id);
  return {models:styled.size,meshes:styledMeshes,printedAtlases:printedAtlas};
}
export async function prepareIslandPrint(wfc,assets) {
  if(wfc.islandPrint)return wfc.islandPrint;
  const loader=new THREE.TextureLoader();
  const get=name=>loader.loadAsync(new URL('island-print/'+name,document.baseURI).href).then(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;});
  const [parcel,road]=await Promise.all([get('parcel-ink.webp'),get('road-ink.webp')]);
  parcel.name='HKIA three-step native paving';road.name='5313 R8 four glyphs on island asphalt';
  wfc.print.parcelPaving=parcel;wfc.print.roadInk=road;
  const counts={};for(const r of wfc.roads){const g=boardRoadGlyph(r.x,r.z);counts[g]=(counts[g]||0)+1;}
  const stats={...stylePrototypes(assets),paletteSource:'680e8ffe11351dc415e56fb8dad85affb1e3055235e2552de8ec13362611b96c',paletteGroups:200,usedGroups:Object.keys(colors).length,roadGlyphs:counts,roadPixels:[road.image.width,road.image.height],parcelPixels:[parcel.image.width,parcel.image.height],roughness:wfc.print.parcelRoughness?.name};
  wfc.islandPrint=stats;return stats;
}

