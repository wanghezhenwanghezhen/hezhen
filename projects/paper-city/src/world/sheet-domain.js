import * as THREE from 'three';
import { OUTLINE } from './sheet-outline.js';
import { MODELS } from '../core/models.js';

export function sheetCoordinates(plan){
  const f=OUTLINE.fit, [bx,by,ex,ey]=f.sourcePixelBounds;
  const scale=f.sheetPixelsPerImagePixel, grid=plan.grid, pitch=grid.pitch, step=pitch*scale/2;
  const px0=grid.originX+pitch/2,py0=grid.originY+pitch/2;
  const U=f.sheetWest+(ey-py0)*scale,V=f.sheetNorth+(px0-bx)*scale;
  const toPage=(x,z)=>[U-z*step,V+x*step];
  const toWorld=(u,v)=>[(v-V)/step,(U-u)/step];
  const imageToPage=(x,y)=>[f.sheetWest+(ey-y)*scale,f.sheetNorth+(x-bx)*scale];
  const polygon=OUTLINE.outline;
  function distanceUV(u,v){
    let inside=false,best=1e20;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const [ax,az]=polygon[j],[bx,bz]=polygon[i],dx=bx-ax,dz=bz-az;
      const t=Math.max(0,Math.min(1,((u-ax)*dx+(v-az)*dz)/(dx*dx+dz*dz)));
      const qx=u-ax-t*dx,qz=v-az-t*dz;best=Math.min(best,qx*qx+qz*qz);
      if((az>v)!==(bz>v)&&u<(bx-ax)*(v-az)/(bz-az)+ax)inside=!inside;
    }
    return (inside?1:-1)*Math.sqrt(best);
  }
  const clearance=(x,z)=>distanceUV(U-z*step,V+x*step)/step;
  return {toPage,toWorld,imageToPage,clearance,distanceUV,step,U,V,polygon,metadata:OUTLINE};
}
export function prepareSheetDomain(wfc,assets){
  const plan=wfc.plan,coords=sheetCoordinates(plan),{toPage,toWorld,imageToPage,clearance,distanceUV,step,U,V,polygon}=coords;
  const [bx,by,ex,ey]=OUTLINE.fit.sourcePixelBounds;
  const mask=document.createElement('canvas');mask.width=1080;mask.height=680;
  const g=mask.getContext('2d',{willReadFrequently:true});g.beginPath();polygon.forEach(([u,v],i)=>i?g.lineTo(u,v):g.moveTo(u,v));g.closePath();g.fillStyle='#fff';g.fill();
  const tex=new THREE.CanvasTexture(mask);
  const [lx,ly,ux,uy]=OUTLINE.bounds;
  const corners=[[lx,ly],[ux,ly],[ux,uy],[lx,uy]].map(([u,v])=>toWorld(u,v));
  const minX=Math.floor(Math.min(...corners.map(c=>c[0]))/2)-1,maxX=Math.ceil(Math.max(...corners.map(c=>c[0]))/2)+1;
  const minZ=Math.floor(Math.min(...corners.map(c=>c[1]))/2)-1,maxZ=Math.ceil(Math.max(...corners.map(c=>c[1]))/2)+1;
  const base=wfc.get.bind(wfc), tileCache=new Map(),deco=[],used=new Set(['meadow','qy_ground']);
  const greens=['grove','meadow_flowers','blossom_orchard','hills','forest','meadow'];
  const blank=(x,z)=>({x,z,tileId:'qy_ground',model:'qy_ground',rot:0,sockets:MODELS.qy_ground.sockets,tags:['open'],biome:'heartland',kind:'off-sheet'});
  for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
    const c=clearance(x*2,z*2);if(c<0)continue;
    const [px,py]=wfc.toPixel(x,z), inCity=px>=bx&&px<=ex&&py>=by&&py<=ey;
    let tile=inCity?base(x,z):blank(x,z);
    if(!inCity){
      const h=(Math.imul(0x82d3,x+513)^Math.imul(0x94d049bb,z+477))>>>0;
      const density=Math.sin(x*.31)+Math.cos(z*.37)+Math.sin(x*.07-z*.19);
      const model=(c>1.9&&h%13<(density>.8?4:1))?greens[(h>>>8)%greens.length]:'qy_ground';
      tile={...tile,model,tileId:model,kind:'paper-margin',sockets:MODELS[model].sockets,tags:MODELS[model].tags,rot:(h>>>16)%4};
    }
    tileCache.set(x+','+z,tile);used.add(tile.model);
    if(tile.model!=='qy_ground'&&(!inCity||tile.kind==='park-companion'))deco.push(tile);
  }
  wfc.get=(x,z)=>tileCache.get(x+','+z)||blank(x,z);
  wfc.peek=wfc.get;wfc.clearance=clearance;
  // Only fixed-world prototype layers are required for the paper bake; all registered definitions stay available.
  assets.modelIds=assets.modelIds.filter(id=>used.has(id));
  const domain={toPage,toWorld,imageToPage,clearance,distanceUV,mask:tex,step,U,V,polygon,metadata:OUTLINE,deco,cells:tileCache,used:[...used]};
  wfc.sheet=domain;return domain;
}
