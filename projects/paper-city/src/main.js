import { loadBakedCity } from './game/baked-city.js';
import * as THREE from 'three';
import { CONFIG,QUALITY } from './core/config.js';
import { createLoop } from './core/loop.js';
import { state } from './core/state.js';
import { createRenderer } from './render/renderer.js';
import { createMaterials } from './render/materials.js';
import { createBoardSheet } from './game/board-sheet.js';

async function boot(){
  const params=new URLSearchParams(location.search);
  const quality=QUALITY[params.get('quality')]?params.get('quality'):CONFIG.DEFAULT_QUALITY;
  const seed=Number(params.get('seed'))||5313;
  state.quality=quality;state.seed=seed;state.cloudDaylight=params.get('night')==='1'?0:1;
  const canvas=document.querySelector('#atlas'),loading=document.querySelector('#loading');
  const {renderer,setSize}=createRenderer({canvas,quality});setSize(innerWidth,innerHeight);
  const materials=createMaterials({quality,loadFibre:false});
  const {wfc,assets}=await loadBakedCity(materials);
  const traveller={position:new THREE.Vector3(),moveDir:new THREE.Vector3(0,0,1),
    teleport(x,z){this.position.set(x,0,z);}};
  loading.textContent='装配纸片与棋子…';
  const sheet=await createBoardSheet({wfc,assets,renderer,quality,traveller});
  window.cityReview={placements:()=>wfc.placements,placement:id=>wfc.placements.find(p=>p.id===id||p.label===id),
    roadEntries:()=>wfc.roads,parcelMaterials:()=>wfc.parcelPaving,streetScenery:()=>wfc.streetScenery.diagnostics(),
    print:()=>wfc.islandPrint};
  const resize=()=>{const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);setSize(w,h);sheet.resize(w,h);};
  resize();window.addEventListener('resize',resize);
  const loop=createLoop({update(dt){
    state.time+=dt;state.frame++;sheet.update(dt);
    state.traveller.x=traveller.position.x;state.traveller.z=traveller.position.z;materials.update(dt);
  },render:sheet.render});
  document.body.dataset.paperMode='overview';sheet.update(0);sheet.render(0);
  document.body.classList.add('ready');performance.mark('board-first-scene');loop.start();
}
boot().catch(e=>{document.querySelector('#loading').textContent='棋盘载入失败 · '+e.message;console.error(e);});
