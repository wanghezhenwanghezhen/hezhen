import * as THREE from 'three';
import {boardFiles} from './board-files.js';
import {CONFIG} from '../core/config.js';
import {sheetCoordinates} from '../world/sheet-domain.js';
import {createPrintedStreetView} from '../world/street-paper-view.js';

const decode=new TextDecoder();
const geometryTypes={Float32Array,Uint32Array,Uint16Array,Uint8Array,Int16Array,Int8Array,Int32Array};
function openPacket(bytes){
  const n=new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0,true);
  const header=JSON.parse(decode.decode(bytes.subarray(4,4+n))),data=(n+7)&~3;
  return {header,data,part(name){const [i,size]=header[name];return bytes.subarray(data+i,data+i+size);}};
}
function originalModel(packet,shared){
  const {header,data}=openPacket(packet);
  function attr([kind,offset,length,size,normalized]){
    const array=new geometryTypes[kind](packet.buffer,packet.byteOffset+data+offset,length);
    return new THREE.BufferAttribute(array,size,normalized);
  }
  const geometries=header.geos.map(g=>{
    const geo=new THREE.BufferGeometry();
    for(const [key,attrib] of Object.entries(g.a))geo.setAttribute(key,attr(attrib));
    if(g.i)geo.setIndex(attr(g.i));
    return geo;
  });
  function restore(n){
    const o=n.g===undefined?new THREE.Group():new THREE.Mesh(geometries[n.g],shared[n.m]);
    o.name=n.n;o.position.fromArray(n.p);o.quaternion.fromArray(n.q);o.scale.fromArray(n.s);o.userData=n.u;
    if(o.isMesh){o.castShadow=n.cast;o.receiveShadow=n.receive;}
    for(const child of n.c||[])o.add(restore(child));
    return o;
  }
  return restore(header.tree);
}
function fetchImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('地图图片载入失败'));img.src=url;
  });
}
async function imageFrom(bytes){
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
  try{return await fetchImage(url);}finally{URL.revokeObjectURL(url);}
}
async function packetFrom(url,priority='auto'){
  const response=await fetch(url,{priority});
  if(!response.ok)throw Error('地图资源 '+response.status);
  return openPacket(new Uint8Array(await response.arrayBuffer()));
}
function makeTexture(image,colour=true){
  const texture=new THREE.Texture(image);
  texture.colorSpace=colour?THREE.SRGBColorSpace:THREE.NoColorSpace;
  texture.anisotropy=4;texture.needsUpdate=true;
  return texture;
}
// Keep the original UV layout. Only visited regions replace the overview pixels.
function regionalAtlas(size,image=null){
  const initial=image||document.createElement('canvas');
  if(!image){initial.width=1;initial.height=1;}
  const texture=makeTexture(initial);
  let context;
  function paint(draw){
    if(!context){
      const canvas=document.createElement('canvas');[canvas.width,canvas.height]=size;
      context=canvas.getContext('2d');
      if(image)context.drawImage(image,0,0,...size);
      texture.dispose();texture.image=canvas;
    }
    draw(context);texture.needsUpdate=true;
  }
  return {texture,paint};
}
function requests(){
  const pending=new Set(),retry=new Map();
  return (key,load)=>{
    if(pending.has(key)||performance.now()<(retry.get(key)||0))return;
    pending.add(key);
    load().catch(()=>retry.set(key,performance.now()+2500)).finally(()=>pending.delete(key));
  };
}
function localScenery(wfc,data){
  let page,visible=new Set(),clock=0;
  const loaded=new Map(),load=requests(),empty={visible:0,standing:0,near:[],byModel:{}};
  function updateSheet(dt,x,z,inspect,zoom,progress){
    clock+=dt;visible=new Set();
    if(progress>.97&&(Number.isFinite(x)||inspect)){
      for(const [ix,iz,file] of data.regions){
        const distance=(a,b)=>Math.hypot(Math.max(ix*8-a,0,a-(ix+1)*8),Math.max(iz*8-b,0,b-(iz+1)*8));
        if(Math.min(distance(x,z),inspect?distance(...inspect):Infinity)>8)continue;
        visible.add(file);
        if(!loaded.has(file))load(file,async()=>{
          const p=await packetFrom(file);
          const layout=JSON.parse(decode.decode(p.part('layout'))),image=await imageFrom(p.part('ink'));
          if(!visible.has(file))return;
          const view=createPrintedStreetView(wfc,layout,makeTexture(image));
          view.attachSheet(page);loaded.set(file,{view,last:clock});
        });
      }
    }
    for(const [key,row] of loaded){
      if(visible.has(key))row.last=clock;
      if(clock-row.last>2){row.view.dispose();loaded.delete(key);continue;}
      row.view.updateSheet(dt,x,z,inspect,zoom,progress);
    }
  }
  return {attachSheet(p){page=p;},updateSheet,diagnostics(){
    const sheet={...empty,near:[],byModel:{}};
    for(const {view} of loaded.values()){
      const s=view.diagnostics().sheet;sheet.standing+=s.standing;sheet.visible+=s.visible;
      sheet.near.push(...s.near);for(const [k,n] of Object.entries(s.byModel))sheet.byModel[k]=(sheet.byModel[k]||0)+n;
    }
    const {regions,...summary}=data;
    return {...summary,sheet,textureReady:loaded.size>0,loadedSectors:[...loaded.keys()],sectorCount:regions.length};
  }};
}
export async function loadBakedCity(materials){
  const packet=await packetFrom(boardFiles.opening,'high');
  performance.mark('board-packet-received');
  const world=JSON.parse(decode.decode(packet.part('world')));
  const [sheetImage,flatImage,roughness]=await Promise.all(['sheet-first','flat-first','roughness'].map(key=>imageFrom(packet.part(key))));
  const ink={sheet:regionalAtlas(world.inkSize.sheet,sheetImage),flat:regionalAtlas(world.inkSize.flat,flatImage),
    art:regionalAtlas(world.inkSize.art),landmarks:regionalAtlas(world.inkSize.landmarks)};
  ink.art.texture.flipY=false;
  const objects=new Map(),painted=new Set(),load=requests();
  let shared,guidePromise,fibreReady=false;
  function sharedMaterials(){
    if(!shared){
      materials.setTextures({art:ink.art.texture});
      shared={paper:materials.paper({color:'#ffffff',side:THREE.DoubleSide}),
        glow:materials.paper({color:'#ffffff',side:THREE.DoubleSide,emissive:CONFIG.assets.glowColor,emissiveIntensity:CONFIG.assets.glowIntensity,fibre:'none',vary:false}),
        landmark:new THREE.MeshStandardMaterial({map:ink.landmarks.texture,roughness:1,metalness:0,vertexColors:true,side:THREE.DoubleSide})};
    }
    if(!fibreReady)load('fibre',async()=>{
      const p=await packetFrom(boardFiles.fibre);
      const [card,normal]=await Promise.all(['card','normal'].map(k=>imageFrom(p.part(k))));
      materials.setTextures({art:ink.art.texture,paper:makeTexture(card),paperNormal:makeTexture(normal,false)});fibreReady=true;
    });
    return shared;
  }
  const assets={getTilePrototype(model){
    if(objects.has(model))return objects.get(model);
    load(model,async()=>{
      const p=await packetFrom(world.models[model]);
      if(p.header.ink){
        const [kind,cols,cells]=JSON.parse(decode.decode(p.part('info'))),image=await imageFrom(p.part('ink'));
        ink[kind].paint(ctx=>cells.forEach(([x,y],i)=>ctx.drawImage(image,i%cols*128,Math.floor(i/cols)*128,128,128,x*128,y*128,128,128)));
      }
      objects.set(model,originalModel(p.part('model'),sharedMaterials()));
    });
    return null;
  }};
  const {grid}=world.plan,layouts=new Map(world.layouts.map(l=>[l.key,{...l,center:new THREE.Vector3(...l.center),
    sweep:new THREE.Box3(new THREE.Vector3(...l.min),new THREE.Vector3(...l.max))}]));
  const wfc={plan:world.plan,placements:world.placements,roads:world.roads,parcelPaving:world.paving,islandPrint:world.print,
    sheet:sheetCoordinates(world.plan),toPixel:(x,z)=>[grid.originX+(x+.5)*grid.pitch,grid.originY+(z+.5)*grid.pitch]};
  function patch(key,file,x,y){
    const region=key+':'+x+','+y;
    if(painted.has(region))return;
    load(region,async()=>{const img=await fetchImage(file);ink[key].paint(ctx=>ctx.drawImage(img,x,y));painted.add(region);});
  }
  wfc.paperAssets={sheet:ink.sheet.texture,roughness:makeTexture(roughness,false),pawn:packet.part('pawn'),
    flat:{layouts,dim:world.dim,texture:ink.flat.texture},
    stamp(i){patch('flat',world.flatTiles[i],(i%world.dim)*144,Math.floor(i/world.dim)*144);},
    ground(u,v){
      const col=Math.max(0,Math.min(5,Math.floor(u/180))),row=Math.max(0,Math.min(3,Math.floor(v/170)));
      patch('sheet',world.groundTiles[row*6+col],col*540,row*510);
    },
    detailState(){return {models:[...objects.keys()],textures:[...painted],districts:objects.size>0};},
    guide(){return guidePromise||=fetchImage(boardFiles.guide).catch(e=>{guidePromise=null;throw e;});}
  };
  wfc.streetScenery=localScenery(wfc,world.street);
  return {wfc,assets};
}
