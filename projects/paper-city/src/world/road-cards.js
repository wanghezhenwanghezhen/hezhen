import * as THREE from 'three';
import {MODELS,MODEL_IDS} from '../core/models.js';
import {TILE_SIZE} from '../core/config.js';

// Papertrails' path tiles were authored for a narrow unpaved path. Their shrubs, crates
// and trees occupy the Qianyu full-width road. Use the paper base without those actors.
export function registerRoadCards(assets) {
  const get=assets.getTilePrototype.bind(assets);
  const base=get('qy_ground').getObjectByName('base');
  const empty=new THREE.Group();empty.name='qy_road';empty.add(base.clone());
  const lit=empty.clone();lit.name='qy_road_lamp';
  const originalLamp=get('lantern_post').children.find(c=>c.name==='lantern_post');
  if(!originalLamp)throw Error('缺少原作可采集路灯组');
  const lamp=originalLamp.clone(true);
  // Canonical lantern_post runs N-S. The furthest edge of the upright lamp stays on
  // the outside of the +X shoulder, also when the original road placement rotates it.
  const box=new THREE.Box3().setFromObject(lamp);
  lamp.position.x+=TILE_SIZE*(.5+.12)+.025-box.min.x;
  lit.add(lamp);
  const prototypes=new Map([[empty.name,empty],[lit.name,lit]]);
  for(const id of prototypes.keys()) {
    const original=id===lit.name?'lantern_post':'path_straight';
    MODELS[id]={...MODELS[original],tags:[...MODELS[original].tags]};
    MODEL_IDS.push(id);assets.modelIds.push(id);
  }
  assets.getTilePrototype=id=>prototypes.get(id)||get(id);
  const meshes=[];lamp.traverse(node=>{if(node.isMesh)meshes.push(node.name);});
  return {emptyModel:empty.name,lampModel:lit.name,sourceLamp:originalLamp.name,lampMeshes:meshes,
    emptyChildren:empty.children.map(c=>c.name),lampChildren:lit.children.map(c=>c.name),
    lampMinLocalX:new THREE.Box3().setFromObject(lit.children[1]).min.x,
    outsideShoulderStartsAt:TILE_SIZE*.62};
}
