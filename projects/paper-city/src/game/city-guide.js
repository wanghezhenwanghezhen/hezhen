import * as THREE from 'three';
import { bus } from '../core/events.js';
import { TILE_SIZE } from '../core/config.js';

export function createGuide({wfc,world,traveller,follow,controls,game,renderer,assets,seed}) {
  const {plan,placements}=wfc;
  const guide=document.querySelector('#city-guide'), picker=document.querySelector('#places'), trigger=document.querySelector('#guide-button'), location=document.querySelector('#place');
  const cityMap=document.querySelector('#city-map'), ctx=cityMap.getContext('2d');
  const placeOptions=[...placements].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN')||a.id.localeCompare(b.id));
  for(const p of placeOptions) {const o=new Option(p.label+' · '+({landmark:'地标',shop:'店铺',park:'公园',residential:'住区'}[p.kind]||p.kind),p.id);picker.add(o);}
  const foldEvents=[];
  for(const type of ['tile:rise','tile:flat'])bus.on(type,e=>{foldEvents.push({type,x:e.x,z:e.z,model:e.tileId});if(foldEvents.length>200)foldEvents.shift();});
  const counts={};
  for(const p of placements)counts[p.usage]=(counts[p.usage]||0)+1;
  function closest(x,z,list){return list.reduce((a,b)=>Math.hypot(b.anchor[0]-x,b.anchor[1]-z)<Math.hypot(a.anchor[0]-x,a.anchor[1]-z)?b:a);}
  function find(name){return placements.find(p=>p.id===name)||placements.find(p=>p.label===name)||placements.find(p=>name&&p.label.includes(name));}
  function safeRoad(row) {
    const [px,pz]=row.anchor;
    const roads=wfc.roads.slice().sort((a,b)=>Math.hypot(a.x-px,a.z-pz)-Math.hypot(b.x-px,b.z-pz));
    for(const {x,z} of roads){
      for(const [dx,dz] of [[0,0],[-.2,0],[.2,0],[0,-.2],[0,.2]]) {
        const at=[x*TILE_SIZE+dx,z*TILE_SIZE+dz];
        if(traveller.canPass(...at))return at;
      }
    }
    throw Error('No legal street entry');
  }
  function position(){return [traveller.position.x,traveller.position.z];}
  let current, focusLabel=null, arrived=null;
  function byModel(row){
    const [x,z]=row.anchor.map(v=>v*TILE_SIZE);
    for(const distance of [1.15,1.42,1.65,1.9,2.15]){
      for(const angle of [0,.34,-.34,.68,-.68,1,-1,Math.PI]){
        const at=[x+Math.sin(angle)*distance,z+Math.cos(angle)*distance];
        if(traveller.canPass(...at))return at;
      }
    }
    return safeRoad(row);
  }
  function focusAt(row,street){
    const to=street?safeRoad(row):byModel(row);
    focusLabel=row; arrived=to; return to;
  }
  function refresh(force=false){
    trigger.hidden=game.modal();
    const [x,z]=position();
    if(arrived&&Math.hypot(x-arrived[0],z-arrived[1])>1.1)focusLabel=null;
    const near=focusLabel||closest(x/TILE_SIZE,z/TILE_SIZE,placements);
    if(!force && current===near.id)return;
    current=near.id;location.textContent=near.label;
  }
  function drawMap() {
    cityMap.width=plan.width;cityMap.height=plan.height;
    // The original survey is already printed a quarter turn on the sheet.
    // The new clockwise turn makes both printed survey axes point backwards.
    ctx.setTransform(-1,0,0,-1,plan.width,plan.height);
    ctx.fillStyle='#f6f0dd';ctx.fillRect(0,0,plan.width,plan.height);
    ctx.drawImage(wfc.print.parcelPaving.image,0,0,plan.width,plan.height);
    for(const p of plan.parcels){
      ctx.strokeStyle='#8a816f';ctx.lineWidth=1.4;ctx.strokeRect(p.x,p.y,p.w,p.h);
    }
    ctx.drawImage(wfc.print.roadInk.image,0,0,plan.width,plan.height);
    const choice=find(picker.value);
    if(choice){ctx.strokeStyle='#a23d31';ctx.lineWidth=5;ctx.strokeRect(...choice.sourceBounds);}
    const [x,z]=position(),[px,py]=wfc.toPixel(x/TILE_SIZE,z/TILE_SIZE);
    ctx.fillStyle='#251f1b';ctx.beginPath();ctx.arc(px,py,10,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff8e5';ctx.lineWidth=4;ctx.stroke();
  }
  function select(p){
    if(!p)return;
    picker.value=p.id;
    const summary=document.querySelector('#representation');
    const names={manor:'庄园',village_b:'街屋',village:'聚落',house:'住宅',barn_farm:'谷仓',market_square:'集市',watchtower:'瞭望塔',village_green:'绿地',grove:'林地',blossom_orchard:'果园',blossom_garden:'花园',hills:'山坡',pond:'池塘'};
    summary.textContent=p.usage==='dedicated-candidate'?'专用地标纸模 · '+p.label:'通用折纸原型 · '+(names[p.model]||p.model);
    drawMap();
  }
  function open(){
    if(game.modal())return;
    controls.clearTarget();
    guide.showModal();
    select(find(current)||placements[0]);
  }
  trigger.addEventListener('click',open);
  document.querySelector('#guide-close').onclick=()=>guide.close();
  picker.onchange=()=>select(find(picker.value));
  cityMap.onclick=e=>{
    const r=cityMap.getBoundingClientRect();
    const scale=Math.min(r.width/plan.width,r.height/plan.height);
    const x=plan.width-(e.clientX-r.left-(r.width-scale*plan.width)/2)/scale;
    const y=plan.height-(e.clientY-r.top-(r.height-scale*plan.height)/2)/scale;
    const hit=plan.parcels.find(p=>x>=p.x&&x<p.x+p.w&&y>=p.y&&y<p.y+p.h);
    if(hit)select(find(hit.id));
  };
  guide.addEventListener('keydown',e=>e.stopPropagation());
  function visit(street){
    const to=focusAt(find(picker.value),street); guide.close(); traveller.teleport(...to); controls.clearTarget();follow.snap(traveller);refresh(true);document.querySelector('#atlas').focus();
  }
  document.querySelector('#guide-travel').onclick=()=>visit(false);
  document.querySelector('#guide-street').onclick=()=>visit(true);
  const fallback=placements.find(p=>p.model==='qy_watercube')||placements.find(p=>p.usage==='dedicated-candidate')||closest(plan.width/(2*plan.grid.pitch),plan.height/(2*plan.grid.pitch),placements);
  const selected=find(new URLSearchParams(window.location.search).get('focus'))||fallback;
  function snapshot() {
    const [x,z]=position(), cx=Math.round(x/TILE_SIZE),cz=Math.round(z/TILE_SIZE);
    const records=[];
    for(let rz=cz-7;rz<=cz+7;rz++)for(let rx=cx-7;rx<=cx+7;rx++){
      const r=world.tileRecord(rx,rz);
      if(r && r.shown)records.push({cell:[rx,rz],model:r.model,parcel:r.cell.parcel??null,fold:r.fold.progress,flaps:(()=>{let n=0;r.group.traverse(c=>{if(c.userData?.hinge)n++;});return n;})(),meshes:r.meshes.length});
    }
    return {nativeRoads:wfc.nativeRoads?.stats??null,input:wfc.inputFile,foldEvents:foldEvents.slice(),seed,source:assets.source,baked:world.book.baked,position:[x,z],cell:[cx,cz],scope:wfc.get(cx,cz).kind,world:world.stats(),walkable:traveller.canPass(x,z),explored:game.progress.cellCount(),lanterns:game.progress.lanternCount(),modal:game.modal(),guideOpen:guide.open,records,renderer:{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles},plan:{width:plan.width,height:plan.height,roads:wfc.roads.length,parcels:placements.length,representations:counts},spawn:selected.id};
  }
  function pieceBounds(id) {
    const row=find(id), r=world.tileRecord(...row.anchor);
    if(!r||r.model!==row.runtimeModel||!r.shown)return null;
    const use=new THREE.Matrix4(), total=new THREE.Box3(), pos=new THREE.Vector3();
    for(let i=0;i<r.meshes.length;i++){
      if(r.hide&&r.hide[i])continue;
      world.drawnMatrix(r,i,use);
      const verts=r.meshes[i].geometry.getAttribute('position');
      for(let j=0;j<verts.count;j++)total.expandByPoint(pos.fromBufferAttribute(verts,j).applyMatrix4(use));
    }
    const [x0,y0]=wfc.toPixel(total.min.x/TILE_SIZE,total.min.z/TILE_SIZE);
    const [x1,y1]=wfc.toPixel(total.max.x/TILE_SIZE,total.max.z/TILE_SIZE);
    const [x,y,w,h]=row.sourceBounds;
    return {pixelBounds:[x0,y0,x1,y1],sourceBounds:row.sourceBounds,fold:r.fold.progress,inside:x0>=x&&y0>=y&&x1<=x+w&&y1<=y+h};
  }
  window.cityReview={snapshot,pieceBounds,screenPoint:(x,z)=>{const p=new THREE.Vector3(x,0,z).project(follow.camera);return [(p.x+1)*innerWidth/2,(1-p.y)*innerHeight/2];},placements:()=>placements,placement:q=>find(q),cell:(x,z)=>wfc.get(x,z),canWalk:(x,z)=>traveller.canPass(x,z),roadEntries:()=>wfc.roads.map(r=>({...r,pass:traveller.canPass(r.x*TILE_SIZE,r.z*TILE_SIZE)}))};
  window.cityReview.streetScenery=()=>wfc.streetScenery.diagnostics();
  window.cityReview.streetSceneryPlacements=()=>wfc.streetScenery.placements();
  window.cityReview.parcelMaterials=()=>wfc.parcelPaving;
  const streetEntry=new URLSearchParams(locationSearch()).get('entry')==='street';
  function locationSearch(){return window.location.search;}
  return {spawn:focusAt(selected,streetEntry),refresh,modal:()=>guide.open};
}
