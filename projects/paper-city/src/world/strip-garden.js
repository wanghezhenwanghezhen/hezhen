import * as THREE from 'three';
import { MODELS, MODEL_IDS,rotToY } from '../core/models.js';
import { createFoldInstance } from './fold.js';
import { TILE_SIZE } from '../core/config.js';

// A fine-grid strip can intersect a paper tile while excluding its centre. Fit shared upstream
// foliage to the intersection and bake the same transformed prototype in the folded/standing atlases.
export function fitStrip(assets,parcel,model,rot,pixel,pitch) {
  const previous=assets.getTilePrototype.bind(assets);
  const source=previous(model);
  const id='qy_strip_'+parcel.id.split('-').pop();
  const tile=new THREE.Group();tile.name=id;
  tile.add(previous('meadow').getObjectByName('base').clone());
  const content=new THREE.Group();content.name='garden_strip';
  for(const child of source.children)if(!child.name.toLowerCase().startsWith('base'))content.add(child.clone(true));
  const probe=content.clone(true), folded=createFoldInstance(probe,{tileId:model});
  const yaw=rotToY(rot);
  probe.rotation.y=yaw;
  const bounds=new THREE.Box3();
  for(const phase of [0,.25,.5,.75,1]){
    folded.snap(phase);probe.updateMatrixWorld(true);
    bounds.union(new THREE.Box3().setFromObject(probe,true));
  }
  const scalePx=TILE_SIZE/pitch;
  const x0=Math.max(parcel.x,pixel[0]-pitch/2),x1=Math.min(parcel.x+parcel.w,pixel[0]+pitch/2);
  const y0=Math.max(parcel.y,pixel[1]-pitch/2),y1=Math.min(parcel.y+parcel.h,pixel[1]+pitch/2);
  const displayPixel=[(x0+x1)/2,(y0+y1)/2];
  const scale=.80*Math.min(1,(x1-x0)*scalePx/(bounds.max.x-bounds.min.x),(y1-y0)*scalePx/(bounds.max.z-bounds.min.z));
  const originalCentre=bounds.getCenter(new THREE.Vector3());
  const dx=(displayPixel[0]-pixel[0])*scalePx-originalCentre.x*scale,dz=(displayPixel[1]-pixel[1])*scalePx-originalCentre.z*scale;
  content.scale.setScalar(scale);
  content.position.set(Math.cos(yaw)*dx-Math.sin(yaw)*dz,0,Math.sin(yaw)*dx+Math.cos(yaw)*dz);
  tile.add(content);
  MODELS[id]={sockets:{...MODELS.meadow.sockets},tags:['open','forest'],biomes:{heartland:1}};
  MODEL_IDS.push(id); assets.modelIds.push(id);
  assets.getTilePrototype=name=>name===id?tile:previous(name);
  const pixelBounds=[bounds.min.x*scale+dx,bounds.min.z*scale+dz,bounds.max.x*scale+dx,bounds.max.z*scale+dz].map((v,i)=>v/scalePx+pixel[i%2]);
  return {id,displayPixel,scale,foldSweepPixelBounds:pixelBounds,inside:pixelBounds[0]>=parcel.x&&pixelBounds[1]>=parcel.y&&pixelBounds[2]<=parcel.x+parcel.w&&pixelBounds[3]<=parcel.y+parcel.h};
}
