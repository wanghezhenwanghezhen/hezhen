import { ink } from './island-palette.js';
import * as THREE from 'three';
import { OUTLINE } from './sheet-outline.js';
import { makeSheetArt, makeSheetRoughness } from './sheet-art.js';
import { createPaperRelief } from './paper-relief.js';

export const PAPER_SCALE=.075;
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const sm=t=>{t=clamp(t);return t*t*(3-2*t);};
export function createFoldedSheet(wfc){
  const relief=createPaperRelief(wfc.sheet);
  wfc.sheet.relief=relief;
  const texture=wfc.paperAssets?.sheet??makeSheetArt(wfc),scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(ink('078'),ink('082',1),1.46));
  const key=new THREE.DirectionalLight(ink('048'),2.02);key.name='key';key.position.set(-32,64,30);key.castShadow=true;
  Object.assign(key.shadow.camera,{left:-54,right:54,top:51,bottom:-51,near:1,far:155});
  key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.00018;key.shadow.normalBias=.015;key.shadow.radius=2;
  scene.add(key,key.target);
  const mat=new THREE.MeshStandardMaterial({map:texture,vertexColors:true,color:ink('078'),roughness:1,roughnessMap:wfc.paperAssets?.roughness??makeSheetRoughness(wfc),metalness:0,side:THREE.DoubleSide});
  // Printed front, softer reverse on a partly folded panel.
  const back=new THREE.Color(ink('067',1));
  mat.onBeforeCompile=s=>{s.uniforms.uIslandReverse={value:back};s.fragmentShader='uniform vec3 uIslandReverse;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif(!gl_FrontFacing)diffuseColor.rgb=mix(uIslandReverse,diffuseColor.rgb,.14);').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nif(!gl_FrontFacing)roughnessFactor=.96;');};
  const edge=new THREE.MeshStandardMaterial({color:ink('130',1),roughness:1,side:THREE.DoubleSide});
  const stage=new THREE.Group();stage.scale.setScalar(PAPER_SCALE);stage.rotation.y=-Math.PI/2;scene.add(stage);
  const columns=OUTLINE.creases.columns, rows=OUTLINE.creases.rows;const middle=3;
  const wing=[],parts=[],pick=[],samples=[],morphs=[];
  let reliefGain=0,unity=0;const inkPeak=new THREE.LineBasicMaterial({color:ink('108'),transparent:true,opacity:0,depthWrite:false});
  const greenRidge=new THREE.LineBasicMaterial({color:ink('004',2),transparent:true,opacity:0,depthWrite:false});
  const paleFold=new THREE.LineBasicMaterial({color:ink('078'),transparent:true,opacity:0,depthWrite:false});
  const raw=OUTLINE.outline;
  function makeWing(i) {
    if(wing[i])return wing[i];
    const anchor=i<=middle?columns[i+1]:columns[i], g=new THREE.Group();g.name='crease-column-'+i;
    if(i===middle){stage.add(g);g.position.x=anchor;}
    else {const j=i<middle?i+1:i-1,pr=makeWing(j);pr.node.add(g);g.position.x=anchor-pr.anchor;}
    return wing[i]={node:g,anchor,i};
  }
  for(let i=0;i<columns.length-1;i++)makeWing(i);
  for(let i=0;i<wing.length;i++){
    parts[i]=[];
    for(let j=0;j<rows.length-1;j++){
      const xa=wing[i].anchor,za=j===0?rows[1]:j===2?rows[2]:0;
      const node=new THREE.Group();node.name='crease-'+i+'-'+j;node.position.z=za;wing[i].node.add(node);
      const pos=[],raised=[],full=[],uv=[],colors=[],side=[],corners=new Map();
      const terrain=relief.panel(i,j);
      for(const triangle of terrain.pieces)for(const [x,z,h,hh] of triangle){
        pos.push(x-xa,0,z-za);raised.push(x-xa,h,z-za);full.push(x-xa,hh,z-za);uv.push(x/1080,1-z/680);
        const tint=Math.min(1,hh/55);
        colors.push(1-.10*tint,1-.04*tint,1-.075*tint);
        const key=Math.round(x*1000)+','+Math.round(z*1000);
        if(!corners.has(key))corners.set(key,[x-xa,z-za,h,hh]);
      }
      if(!pos.length){parts[i][j]={node,x:xa,z:za};continue;}
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
      function raisedAttributes(data,seamBlend){
        const elevated=new THREE.BufferGeometry();
        elevated.setAttribute('position',new THREE.Float32BufferAttribute(data,3));elevated.computeVertexNormals();
        const normals=elevated.attributes.normal,n=new THREE.Vector3(),avg=new THREE.Vector3();
        for(let v=0;v<normals.count;v++){
          if(data[v*3+1]<.01)continue;
          const x=data[v*3]+xa,z=data[v*3+2]+za,step=8;
          const sx=(relief.heightAt(x+step,z,seamBlend)-relief.heightAt(x-step,z,seamBlend))/(2*step);
          const sz=(relief.heightAt(x,z+step,seamBlend)-relief.heightAt(x,z-step,seamBlend))/(2*step);
          avg.set(-sx,1,-sz).normalize();n.fromBufferAttribute(normals,v).lerp(avg,.56).normalize();
          normals.setXYZ(v,n.x,n.y,n.z);
        }
        return elevated.attributes;
      }
      const hinged=raisedAttributes(raised,0),joined=raisedAttributes(full,1);
      geo.morphAttributes.position=[hinged.position,joined.position];geo.morphAttributes.normal=[hinged.normal,joined.normal];
      geo.computeBoundingBox();geo.computeBoundingSphere();
      const page=new THREE.Mesh(geo,mat);page.name='sheet-panel-'+i+'-'+j;page.castShadow=true;page.receiveShadow=true;node.add(page);pick.push(page);morphs.push(page);
      for(const band of ['valley','mountain','crest']){
        const base=[],top=[],complete=[];
        const lines=band==='crest'?terrain.crests:terrain.edges.filter(e=>e.mountain===(band==='mountain'));
        for(const edge of lines)for(const [x,z,h,,hh] of [edge.a,edge.b]){
          base.push(x-xa,.085,z-za);top.push(x-xa,.085+h,z-za);complete.push(x-xa,.085+hh,z-za);
        }
        if(base.length){
          const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(base,3));
          lg.morphAttributes.position=[new THREE.Float32BufferAttribute(top,3),new THREE.Float32BufferAttribute(complete,3)];
          const line=new THREE.LineSegments(lg,band==='crest'?inkPeak:band==='mountain'?paleFold:greenRidge);
          line.name=band+'-crease';line.userData.hillFold=true;
          node.add(line);morphs.push(line);
        }
      }
      // Exposed cut edge around this physical panel, including edges seen while it folds away.
      for(let t=0;t<raw.length;t++){let a=raw[t],b=raw[(t+1)%raw.length],lo=0,hi=1;
        for(const [axis,l,h] of [[0,columns[i],columns[i+1]],[1,rows[j],rows[j+1]]]){
          const dd=b[axis]-a[axis];
          if(!dd){if(a[axis]<l||a[axis]>h){lo=2;break;}continue;}
          const t1=(l-a[axis])/dd,t2=(h-a[axis])/dd;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
        }
        if(hi<=lo)continue;
        const px=k=>a[0]+(b[0]-a[0])*k-xa,pz=k=>a[1]+(b[1]-a[1])*k-za;
        side.push(px(lo),0,pz(lo),px(hi),0,pz(hi),px(lo),-.9,pz(lo), px(lo),-.9,pz(lo),px(hi),0,pz(hi),px(hi),-.9,pz(hi));
      }
      if(side.length){const e=new THREE.BufferGeometry();e.setAttribute('position',new THREE.Float32BufferAttribute(side,3));e.computeVertexNormals();node.add(new THREE.Mesh(e,edge));}
      samples.push({node,points:[...corners.values()]});
      parts[i][j]={node,x:xa,z:za};
    }
  }
  function part(u,v){const i=clamp(columns.findIndex((b,k)=>k>0&&u<=b)-1,0,wing.length-1);const j=clamp(rows.findIndex((b,k)=>k>0&&v<=b)-1,0,2);return parts[i][j];}
  const box=new THREE.Box3(),point=new THREE.Vector3(),frameMatrix=new THREE.Matrix4();
  const posedPoints=new Float32Array(samples.reduce((n,row)=>n+row.points.length,0)*3);
  function pose(p){
    const accordion=1-sm(p/.69),cross=1-sm((p-.45)/.39);
    for(let i=0;i<wing.length;i++){
      const delta=i-middle;
      wing[i].node.rotation.z=delta===0?0:(Math.abs(delta)%2===1?1:-1)*Math.sign(delta)*accordion*(Math.PI*.955);
      for(let j=0;j<3;j++)parts[i][j].node.rotation.x=j===1?0:(j===0?1:-1)*cross*Math.PI*(j===0?.942:.905);
    }
    reliefGain=relief.gain(p);
    unity=relief.unifyGain(p);
    for(const m of morphs){m.morphTargetInfluences[0]=reliefGain*(1-unity);m.morphTargetInfluences[1]=reliefGain*unity;}
    greenRidge.opacity=.08*reliefGain;paleFold.opacity=.10*reliefGain;inkPeak.opacity=.54*reliefGain;
    stage.position.set(0,0,0);stage.updateMatrixWorld(true);box.makeEmpty();
    let id=0;
    for(const s of samples)for(const [x,z,h,hh] of s.points){
      point.set(x,(h*(1-unity)+hh*unity)*reliefGain,z).applyMatrix4(s.node.matrixWorld);box.expandByPoint(point);
      posedPoints[id++]=point.x;posedPoints[id++]=point.y;posedPoints[id++]=point.z;
    }
    stage.position.set(-(box.max.x+box.min.x)/2,-box.min.y+.025,-(box.max.z+box.min.z)/2);stage.updateMatrixWorld(true);
    return box.getSize(new THREE.Vector3()).toArray();
  }
  function worldAt(u,v,out=new THREE.Vector3()){
    const panel=part(u,v);return out.set(u-panel.x,relief.heightAt(u,v,unity)*reliefGain,v-panel.z).applyMatrix4(panel.node.matrixWorld);
  }
  const terrainLocal=new THREE.Vector3();
  function heightAtWorldXZ(x,z){
    terrainLocal.set(x,0,z);stage.worldToLocal(terrainLocal);
    const u=terrainLocal.x,v=terrainLocal.z;
    if(wfc.sheet.distanceUV(u,v)<0)return -.22;
    return stage.position.y+relief.heightAt(u,v,unity)*reliefGain*PAPER_SCALE;
  }
  function terrainInfo(){
    return {rotationYDegrees:THREE.MathUtils.radToDeg(stage.rotation.y),gain:reliefGain,unified:unity,primarySpines:relief.spines,peakWorld:Math.max(...Object.values(relief.probes).map(p=>p[2]))*PAPER_SCALE,plain:relief.plain,creaseLines:relief.creaseCount,
      samples:Object.fromEntries(Object.entries(relief.probes).map(([key,[u,v,h]])=>[key,{uv:[u,v],heightPage:relief.heightAt(u,v,unity)*reliefGain,heightOpenWorld:h*PAPER_SCALE,world:worldAt(u,v).toArray()}]))};
  }
  function projectedBounds(camera){
    frameMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for(let i=0;i<posedPoints.length;i+=3){
      point.fromArray(posedPoints,i).add(stage.position).applyMatrix4(frameMatrix);
      left=Math.min(left,point.x);right=Math.max(right,point.x);
      bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);
    }
    return {left,right,bottom,top,extent:Math.max(-left,right,-bottom,top)};
  }
  const maxViewportCoordinate=camera=>projectedBounds(camera).extent;
  return {scene,stage,parts,part,pick,pose,maxViewportCoordinate,projectedBounds,worldAt,terrainInfo,heightAtWorldXZ,plain:relief.plain,height:(u,v)=>relief.heightAt(u,v,unity)*reliefGain,xyScale:PAPER_SCALE,key,texture,faceCount:pick.length,triangles:pick.reduce((n,p)=>n+p.geometry.attributes.position.count/3,0)};
}
