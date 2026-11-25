import { fitStrip } from './strip-garden.js';
import { registerRoadCards } from './road-cards.js';
import * as THREE from 'three';
import { MODELS, MODEL_IDS, rotateSockets } from '../core/models.js';
import { TILE_SIZE } from '../core/config.js';
import { registerCityCards, cityCardId } from './city-cards.js';

const directions = [[0,-1],[1,0],[0,1],[-1,0]];
const names = ['n','e','s','w'];
const roadTypes = ['path_straight','path_corner','path_t','path_cross','path_end'];
const key = (x,z) => x+','+z;
const hash = s => [...String(s)].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);

function registerBlank(assets) {
  const previous=assets.getTilePrototype.bind(assets);
  const tile=new THREE.Group();
  tile.name='qy_ground';
  tile.add(previous('meadow').getObjectByName('base').clone());
  MODELS.qy_ground={sockets:{...MODELS.meadow.sockets},tags:['open'],biomes:{heartland:1}};
  MODEL_IDS.push('qy_ground');
  assets.modelIds.push('qy_ground');
  assets.getTilePrototype=id=>id==='qy_ground'?tile:previous(id);
}

function prototypeFor(parcel) {
  const label=parcel.label || '', special=cityCardId(label);
  if(special) return {model:special,usage:'dedicated-candidate'};
  const select=ids=>ids[hash(parcel.id)%ids.length];
  let model;
  if(parcel.kind==='park') {
    model=/湖|水库/.test(label)?'pond':/山|长城/.test(label)?'hills':select(['grove','blossom_garden','blossom_orchard','village_green']);
  } else if(parcel.kind==='shop') {
    model=/集|市|铺|商|店|摊/.test(label)?'market_square':select(['market_square','house','barn_farm','village_b']);
  } else if(parcel.kind==='residential') {
    model=select(['village','village_b','house','manor']);
  } else if(/塔|钟楼|鼓楼|广播/.test(label)) model='watchtower';
  else if(/寺|宫|庙|楼|祠|院|馆|大学|门/.test(label)) model='manor';
  else if(/公园|动物园|林/.test(label)) model='grove';
  else model=select(['manor','watchtower','barn_farm','market_square']);
  return {model,usage:'upstream-semantic-proxy'};
}

export function createCityPlan(plan,assets,seed) {
  registerCityCards(THREE,assets,MODELS,MODEL_IDS);
  registerBlank(assets);
  const roadCardPolicy=registerRoadCards(assets);
  const pitch=plan.grid.pitch, ox=plan.grid.originX+pitch/2, oy=plan.grid.originY+pitch/2;
  const toPixel=(x,z)=>[ox+x*pitch,oy+z*pitch];
  const toGrid=(x,y)=>[(x-ox)/pitch,(y-oy)/pitch];
  const cell=(x,z,model,rot,properties={})=>({x,z,tileId:model,model,rot,sockets:rotateSockets(MODELS[model].sockets,rot),tags:MODELS[model].tags,biome:'heartland',...properties});
  const cells=new Map(), roads=new Map();
  for(const road of plan.roads) {
    const [x,z]=road.cell ?? toGrid(road.x+road.w/2,road.y+road.h/2).map(Math.round);
    roads.set(key(x,z),{x,z});
  }
  for(const [id,r] of roads) {
    const bits=directions.map(([dx,dz])=>roads.has(key(r.x+dx,r.z+dz)));
    const candidates=['lantern_post',...roadTypes];
    if((r.x+3*r.z)%9!==0)candidates.shift();
    let match;
    for(const model of candidates){
      for(let i=0;i<4;i++){
        const rot=(i+(hash(id)%4))%4;
        const sock=rotateSockets(MODELS[model].sockets,rot);
        if(names.every((name,i)=>(sock[name]==='path')===bits[i])){match=cell(r.x,r.z,model,rot,{kind:'road'});break;}
      }
      if(match)break;
    }
    // Preserve the native directional sockets, tile identity, path and lantern tags.
    // The two display prototypes contain no Papertrails road shrubs, buildings or crates.
    if(match)match.model=match.tileId==='lantern_post'?'qy_road_lamp':'qy_road';
    cells.set(id,match||cell(r.x,r.z,'qy_road',0,{kind:'isolated-road'}));
  }
  const roadList=[...roads.values()];
  const nearestRoad=(x,z)=>roadList.reduce((best,r)=>Math.hypot(r.x-x,r.z-z)<Math.hypot(best.x-x,best.z-z)?r:best);
  const placements=[];
  const buildingSolids=new Map();
  const sorted=[...plan.parcels].sort((a,b)=>a.w*a.h-b.w*b.h || a.id.localeCompare(b.id));
  for(const parcel of sorted) {
    const [cx,cz]=toGrid(parcel.x+parcel.w/2,parcel.y+parcel.h/2);
    const candidates=[];
    for(let z=Math.ceil(cz-parcel.h/2/pitch-.5);z<=Math.floor(cz+parcel.h/2/pitch+.5);z++)
      for(let x=Math.ceil(cx-parcel.w/2/pitch-.5);x<=Math.floor(cx+parcel.w/2/pitch+.5);x++){
        if(cells.has(key(x,z)))continue;
        const [px,py]=toPixel(x,z);
        const overlap=Math.max(0,Math.min(px+pitch/2,parcel.x+parcel.w)-Math.max(px-pitch/2,parcel.x))*Math.max(0,Math.min(py+pitch/2,parcel.y+parcel.h)-Math.max(py-pitch/2,parcel.y));
        if(overlap<=0)continue;
        const inside=px>=parcel.x&&px<parcel.x+parcel.w&&py>=parcel.y&&py<parcel.y+parcel.h;
        candidates.push({x,z,inside,score:(inside?0:20)+Math.hypot(x-cx,z-cz)-overlap/(pitch*pitch)*.1});
      }
    candidates.sort((a,b)=>a.score-b.score || a.z-b.z || a.x-b.x);
    const pos=candidates[0];
    if(!pos) throw Error('No unique city anchor for '+parcel.id+' '+parcel.label);
    const {model,usage}=prototypeFor(parcel);
    const road=nearestRoad(pos.x,pos.z);
    const dx=road.x-pos.x,dz=road.z-pos.z;
    const rot=model.startsWith('qy_')?0:Math.abs(dx)>Math.abs(dz)?(dx>0?3:1):(dz<0?2:0);
    const placed={id:parcel.id,label:parcel.label||('未辨识地块 '+parcel.id),sourceLabel:parcel.label??null,kind:parcel.kind,model,usage,anchor:[pos.x,pos.z],sourceCentre:[parcel.x+parcel.w/2,parcel.y+parcel.h/2],anchorPixel:toPixel(pos.x,pos.z),anchorInside:pos.inside,sourceBounds:[parcel.x,parcel.y,parcel.w,parcel.h],rot,street:[road.x,road.z]};
    const strip=pos.inside?null:fitStrip(assets,parcel,model,rot,placed.anchorPixel,pitch);
    placed.runtimeModel=strip?.id||model;
    placed.displayAnchorPixel=strip?.displayPixel||placed.anchorPixel;
    placed.displayAnchorInside=strip?.inside??pos.inside;
    if(strip)placed.stripFit=strip;
    // These low, closed four-wall models fall below the upstream blocker height band.
    // The four facade hinges describe their ground perimeter independently of how far a spring is unfolded.
    if(model==='qy_watercube'||model==='qy_stadium'){
      const facades=assets.getTilePrototype(model).children.filter(c=>c.userData?.hinge);
      const halfWidth=Math.max(...facades.map(c=>Math.abs(c.position.x)));
      const halfDepth=Math.max(...facades.map(c=>Math.abs(c.position.z)));
      placed.blockingFootprint={shape:'rect',halfWidth,halfDepth,source:'upright facade hinges'};
      buildingSolids.set(key(pos.x,pos.z),placed.blockingFootprint);
    }
    placements.push(placed);
    cells.set(key(pos.x,pos.z),cell(pos.x,pos.z,placed.runtimeModel,rot,{parcel:parcel.id,kind:parcel.kind}));
  }
  const parks=placements.filter(p=>p.kind==='park');
  for(const park of parks) {
    const [px,py,pw,ph]=park.sourceBounds;
    if(pw*ph<6*pitch*pitch) continue;
    const [ax,az]=park.anchor;
    for(let z=Math.ceil((py-oy)/pitch);z<=(py+ph-oy)/pitch;z++)
      for(let x=Math.ceil((px-ox)/pitch);x<=(px+pw-ox)/pitch;x++){
        if(cells.has(key(x,z))||Math.hypot(x-ax,z-az)<1.7 || hash(key(x,z)+park.id)%4!==0)continue;
        const n=hash(park.id+key(x,z));
        const model=['grove','meadow_flowers','blossom_orchard'][n%3];
        cells.set(key(x,z),cell(x,z,model,n%4,{parcel:park.id,kind:'park-companion'}));
      }
  }
  const bounds=[Math.min(...plan.parcels.map(p=>p.x),...plan.roads.map(p=>p.x)),Math.min(...plan.parcels.map(p=>p.y),...plan.roads.map(p=>p.y)),Math.max(...plan.parcels.map(p=>p.x+p.w),...plan.roads.map(p=>p.x+p.w)),Math.max(...plan.parcels.map(p=>p.y+p.h),...plan.roads.map(p=>p.y+p.h))];
  const [west,north]=toGrid(bounds[0],bounds[1]), [east,south]=toGrid(bounds[2],bounds[3]);
  const clearance=(x,z)=>Math.min(x-west*TILE_SIZE,east*TILE_SIZE-x,z-north*TILE_SIZE,south*TILE_SIZE-z);
  function solidClearance(x,z){
    const cx=Math.round(x/TILE_SIZE),cz=Math.round(z/TILE_SIZE);
    const solid=buildingSolids.get(key(cx,cz));if(!solid)return Infinity;
    const dx=Math.abs(x-cx*TILE_SIZE)-solid.halfWidth, dz=Math.abs(z-cz*TILE_SIZE)-solid.halfDepth;
    return Math.hypot(Math.max(0,dx),Math.max(0,dz))+Math.min(0,Math.max(dx,dz));
  }
  const blank=new Map();
  function get(x,z) {
    const id=key(x,z);
    if(cells.has(id))return cells.get(id);
    if(!blank.has(id))blank.set(id,cell(x,z,'qy_ground',0,{kind:'ground'}));
    return blank.get(id);
  }
  const surface=document.createElement('canvas');
  surface.width=Math.round(plan.width);surface.height=Math.round(plan.height);
  const ctx=surface.getContext('2d');
  const inks={residential:'#c7a876',landmark:'#bc8a7d',park:'#8caa7a',shop:'#86a6ac'};
  for(const p of plan.parcels) {
    ctx.globalAlpha=.27;ctx.fillStyle=inks[p.kind]||'#bfad8b';ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.globalAlpha=.72;ctx.strokeStyle='#8d7554';ctx.lineWidth=1.1;ctx.strokeRect(p.x+.55,p.y+.55,p.w-1.1,p.h-1.1);
  }
  const inkTexture=new THREE.CanvasTexture(surface);
  inkTexture.colorSpace=THREE.SRGBColorSpace;
  const wfc={seed,get,peek:get,size:cells.size,clearance,solidClearance,print:{ink:inkTexture,uv:[pitch/TILE_SIZE/plan.width,pitch/TILE_SIZE/plan.height,ox/plan.width,oy/plan.height]},placements,roads:roadList,plan,toPixel};
  wfc.roadCardPolicy=roadCardPolicy;
  return wfc;
}
