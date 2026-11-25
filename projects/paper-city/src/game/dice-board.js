import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoundedBoxGeometry} from './hezhen-rounded-box.js';
import {boardRoadGlyph} from '../world/island-road-glyphs.js';
import {TILE_SIZE} from '../core/config.js';
import {boardFiles,detailPawnSHA,runtimePawnSHA} from './board-files.js';

// 5196 report-playground-20261102/src/map-scene.js and pawn-model.js.
// One source board pitch maps to one 5313 road cell, retaining the original pawn/die dimensions.
export const BOARD_START = Object.freeze([14,10]);
const PAWN_URL='hezhen-board/pawn-tripo-608b95c5.glb';
const PAWN_SHA='8cf723648e2a862de6b79088f8c640482bbbe43d981a8ed4f80e549370a5e742';
const PAWN_HEIGHT=1.1,HEAD_DICE=PAWN_HEIGHT+.36+.025,HOVER_DICE=HEAD_DICE+.35;
const DIRS=[
  {id:'N',label:'向北',dx:0,dz:-1},{id:'E',label:'向东',dx:1,dz:0},
  {id:'S',label:'向南',dx:0,dz:1},{id:'W',label:'向西',dx:-1,dz:0}
];
const key=(x,z)=>x+','+z;
const ORIENTATION=[[-Math.PI/2,0,0],[Math.PI/2,0,0],[0,0,Math.PI/2],[0,0,-Math.PI/2],[0,0,0],[Math.PI,0,0]];
const PIPS=[[[0,0]],[[-1,-1],[1,1]],[[-1,-1],[0,0],[1,1]],[[-1,-1],[-1,1],[1,-1],[1,1]],[[-1,-1],[-1,1],[0,0],[1,-1],[1,1]],[[-1,-1],[-1,0],[-1,1],[1,-1],[1,0],[1,1]]];
const SKINS=['果冻粉','果冻蓝','软糖粉','软糖蓝'];
const limit=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));

function originalDice(){
  const group=new THREE.Group();group.name='hezhen-gummy-die';
  const body=new THREE.Mesh(new RoundedBoxGeometry(.72,.72,.72,3,.12),new THREE.MeshPhysicalMaterial({color:0xf5a4d3,roughness:.12,metalness:.15,clearcoat:1,transparent:true,opacity:.95}));
  body.castShadow=true;group.add(body);
  const dotGeometry=new THREE.SphereGeometry(.052,12,8),materials=[];
  PIPS.forEach((points,f)=>{
    const face=new THREE.Group();face.name='die-face-'+(f+1);
    if(f===0)face.position.z=.367;
    if(f===1){face.rotation.y=Math.PI;face.position.z=-.367;}
    if(f===2){face.rotation.y=Math.PI/2;face.position.x=.367;}
    if(f===3){face.rotation.y=-Math.PI/2;face.position.x=-.367;}
    if(f===4){face.rotation.x=-Math.PI/2;face.position.y=.367;}
    if(f===5){face.rotation.x=Math.PI/2;face.position.y=-.367;}
    for(const [x,y] of points){
      const material=new THREE.MeshStandardMaterial({color:0xffeff8,metalness:.2,roughness:.22});materials.push(material);
      const dot=new THREE.Mesh(dotGeometry,material);dot.scale.z=.3;dot.position.set(x*.17,y*.17,0);face.add(dot);
    }
    group.add(face);
  });
  function skin(i){
    body.material.color.set([0xf5a4d3,0x9cbbfa,0xf7a3bf,0x8fc3f2][i]);body.material.roughness=i<2?.12:.5;
    materials.forEach((m,j)=>m.color.set(i<2?0xffeff8:[0xf9cb48,0xe869aa,0x60bedb,0x98c56d][j%4]));
  }
  return {group,skin};
}
async function originalPawn(renderer,packet,hash=runtimePawnSHA){
  const loader=new GLTFLoader();
  const {scene:model}=packet?await loader.parseAsync(packet.slice().buffer,''):await loader.loadAsync(new URL(PAWN_URL,document.baseURI).href);
  model.rotation.y=-Math.PI/2;model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<=0)throw Error('棋子模型高度无效');
  model.scale.multiplyScalar(PAWN_HEIGHT/size.y);model.updateMatrixWorld(true);bounds.setFromObject(model);
  const center=bounds.getCenter(new THREE.Vector3());model.position.set(-center.x,-bounds.min.y,-center.z);
  const pivot=new THREE.Group();pivot.name='pawn-bottom-center';pivot.add(model);pivot.updateMatrixWorld(true);
  let triangles=0;model.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=true;o.receiveShadow=true;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)m.map.anisotropy=Math.min(8,renderer?.capabilities?.getMaxAnisotropy()||4);
  });
  bounds.setFromObject(pivot);
  pivot.userData={source:'tripo_convert_608b95c5',sourceSha256:PAWN_SHA,sha256:packet?hash:PAWN_SHA,triangles,height:PAWN_HEIGHT,baseCenter:[(bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2],bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
  return pivot;
}

export function createDiceBoard({wfc,page,domain=wfc.sheet,traveller,renderer,onPass,onChange,random=Math.random}){
  const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
  const cells=new Map();
  for(const {x,z} of wfc.roads)cells.set(key(x,z),{x,z,id:key(x,z),neighbors:[]});
  for(const c of cells.values()){
    for(const dir of DIRS){const target=cells.get(key(c.x+dir.dx,c.z+dir.dz));if(target)c.neighbors.push({...dir,target});}
  }
  const start=cells.get(key(...BOARD_START));
  if(!start||!start.neighbors.length)throw Error('水立方旁的原生起点未接入道路');
  const root=new THREE.Group(),pawn=new THREE.Group(),die=originalDice(),ring=new THREE.Mesh(new THREE.RingGeometry(.37,.46,40),new THREE.MeshBasicMaterial({color:0xffd956,side:THREE.DoubleSide,transparent:true,opacity:.79,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  root.name='hezhen-board-traveller';pawn.name='hezhen-jump';root.add(ring,pawn,die.group);
  ring.name='active-road-cell';ring.rotation.x=-Math.PI/2;ring.position.y=.012;
  const pitch=domain.step*TILE_SIZE;root.scale.setScalar(pitch);
  const clock={rolling:reduce?.15:1.5,landing:.32,moving:reduce?.03:.42};
  let cell=start,previous=null,segment=null,selected=null,heading=start.neighbors[0],modelInfo=null;
  let phase='loading',phaseTime=0,time=0,open=1,result=0,stepsDone=0,turn=0,skin=0,error=null,jump=0;
  let px=cell.x,pz=cell.z;
  const history=[],screen=new THREE.Vector3();
  function exits(at=cell,prev=previous,incoming=heading){
    const onward=at.neighbors.filter(d=>d.target!==prev);
    const pool=onward.length?onward:at.neighbors;
    return pool.find(d=>d.id===incoming?.id)||pool[0];
  }
  function choices(){
    const best=exits();return cell.neighbors.map(d=>({id:d.id,label:d.label,cell:[d.target.x,d.target.z],selected:selected===d.id,preferred:d===best}));
  }
  function point(){return {cell:[cell.x,cell.z],world:[px*TILE_SIZE,pz*TILE_SIZE],uv:domain.toPage(px*TILE_SIZE,pz*TILE_SIZE),jump,heading:Math.atan2(heading.dx,heading.dz)};}
  function snapshot(){return {...point(),phase,result,turn,stepsDone,remaining:result-stepsDone,choices:choices(),skin,skinName:SKINS[skin],error,pawn:modelInfo,canRoll:phase==='idle'&&open>.97,history:history.slice(-40),topFace:result||5,
    tileType:boardRoadGlyph(cell.x,cell.z),start:BOARD_START.slice(),cellCount:cells.size,stepSeconds:clock.moving,phaseTime,nextCell:segment?[segment.target.x,segment.target.z]:null};}
  function change(what){onChange?.(snapshot(),what);}
  function paint(){
    const [x,z]=domain.toPage(px*TILE_SIZE,pz*TILE_SIZE),part=page.part(x,z);
    if(root.parent!==part.node)part.node.add(root);
    root.position.set(x-part.x,page.height(x,z)+.26,z-part.z);root.visible=!!modelInfo&&open>.93;
    const headingPage=-Math.PI/2+Math.atan2(heading.dx,heading.dz);
    pawn.rotation.y=headingPage;pawn.position.y=jump;
    const d=die.group;
    if(phase==='rolling'){
      d.rotation.set(phaseTime*8,phaseTime*11,phaseTime*6);
      d.position.y=HOVER_DICE+(reduce?0:Math.sin(phaseTime*4)*.55);
    }else if(phase==='landing'){
      d.position.y=THREE.MathUtils.lerp(HOVER_DICE,HEAD_DICE,limit(phaseTime/clock.landing));
    }else if(phase==='moving')d.position.y=HEAD_DICE+jump;
    else{d.position.y=HOVER_DICE+(reduce?0:Math.sin(time*1.6)*.07);if(!result)d.rotation.y=reduce?0:Math.sin(time*.5)*.2;}
    ring.material.opacity=reduce?.82:.70+.15*Math.cos(time*2.4);
    if(traveller){traveller.position.x=px*TILE_SIZE;traveller.position.z=pz*TILE_SIZE;}
  }
  function choose(id){
    const exit=cell.neighbors.find(d=>d.id===id);if(phase!=='idle'||!exit)return false;
    selected=id;heading=exit;paint();change('choose');return true;
  }
  function startHop(){
    segment=cell.neighbors.find(d=>d.id===selected)||exits();
    selected=null;if(!segment)throw Error('道路断开 '+cell.id);
    heading=segment;
  }
  function roll(){
    if(phase!=='idle'||open<=.97)return false;
    result=1+Math.floor(limit(random(),0,.9999999999)*6);
    turn++;stepsDone=0;phase='rolling';phaseTime=0;change('roll');return true;
  }
  function completeHop(){
    const old=cell;cell=segment.target;previous=old;stepsDone++;px=cell.x;pz=cell.z;jump=0;segment=null;
    const event={turn,from:[old.x,old.z],cell:[cell.x,cell.z],world:[px*TILE_SIZE,pz*TILE_SIZE],ordinal:stepsDone,total:result,type:boardRoadGlyph(cell.x,cell.z)};
    history.push(event);if(history.length>220)history.shift();
    paint();onPass?.(event);
    if(stepsDone>=result){phase='idle';heading=exits();change('arrived');}
    else{startHop();change('step');}
  }
  function update(dt,{progress=1}={}){
    open=progress;if(open<=.97){paint();return;}
    let remaining=Math.max(0,Number(dt)||0);time+=remaining;
    while(remaining>1e-10&&Object.hasOwn(clock,phase)){
      const duration=clock[phase],slice=Math.min(remaining,duration-phaseTime);
      phaseTime+=slice;remaining-=slice;
      if(phase==='moving'){
        const f=limit(phaseTime/duration);px=THREE.MathUtils.lerp(cell.x,segment.target.x,f);pz=THREE.MathUtils.lerp(cell.z,segment.target.z,f);
        jump=reduce?0:Math.sin(Math.PI*f)*.55;
      }
      if(phaseTime+1e-10<duration)break;
      phaseTime=0;
      if(phase==='rolling'){die.group.rotation.set(...ORIENTATION[result-1]);phase='landing';change('land');}
      else if(phase==='landing'){phase='moving';startHop();change('moving');}
      else completeHop();
    }
    paint();
  }
  function placeNearest(wx,wz){
    if(phase!=='idle'&&phase!=='loading')return false;
    let best=null,dist=Infinity;for(const c of cells.values()){const d=(c.x*TILE_SIZE-wx)**2+(c.z*TILE_SIZE-wz)**2;if(d<dist){dist=d;best=c;}}
    if(!best)return false;
    cell=best;previous=null;selected=null;heading=exits();px=cell.x;pz=cell.z;jump=0;paint();change('positioned');return true;
  }
  function changeSkin(){skin=(skin+1)%SKINS.length;die.skin(skin);change('skin');return skin;}
  function hit(raycaster){return root.visible&&raycaster.intersectObject(die.group,true).length>0;}
  function screenAnchor(camera,width=innerWidth,height=innerHeight){die.group.getWorldPosition(screen);screen.project(camera);return [(screen.x+1)*width/2,(1-screen.y)*height/2];}
  paint();
  const ready=originalPawn(renderer,wfc.paperAssets?.pawn).then(p=>{pawn.add(p);modelInfo=p.userData;phase='idle';paint();change('ready');return modelInfo;}).catch(e=>{phase='error';error=e?.message||String(e);change('error');throw e;});
  let detailPending=false,retryDetail=0;
  function detail(zoom){
    if(zoom<1.8||!modelInfo||!wfc.paperAssets||modelInfo.sha256===detailPawnSHA||detailPending||performance.now()<retryDetail)return;
    detailPending=true;
    fetch(boardFiles['pawn-detail']).then(r=>{
      if(!r.ok)throw Error('棋子细节 '+r.status);
      return r.arrayBuffer();
    }).then(buf=>originalPawn(renderer,new Uint8Array(buf),detailPawnSHA)).then(full=>{
      const previous=pawn.children[0];
      pawn.add(full);pawn.remove(previous);modelInfo=full.userData;
      previous.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose();}});
    }).catch(()=>{retryDetail=performance.now()+5000;}).finally(()=>{detailPending=false;});
  }
  return {ready,roll,update,snapshot,point,choose,placeNearest,hit,changeSkin,screenAnchor,detail};
}
