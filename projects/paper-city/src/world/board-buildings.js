import * as THREE from 'three';
import { createFoldInstance } from './fold.js';
import { rotToY } from '../core/models.js';
import { parcelCaption } from './parcel-label.js';

function paperPiece(assets,model) {
  const source=assets.getTilePrototype(model);
  if(!source)return null;
  const piece=source.clone(true),bases=[];
  piece.traverse(o=>{if(/^base(?:$|[_ .-])/i.test(o.name))bases.push(o);});
  for(const base of bases)base.removeFromParent();
  return piece;
}
function bounds(group) {
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group,true);
}
// Bake the actual closed paper faces once. One instanced print per panel keeps
// every parcel present while avoiding hundreds of animated off-screen models.
function createFlatAtlas(renderer,assets,placements) {
  const layouts=new Map(),scene=new THREE.Scene();
  const sun=new THREE.DirectionalLight(0xffffff,1.4);sun.position.set(-3,9,3);
  scene.add(sun,new THREE.HemisphereLight(0xfff9ef,0xf3d7d4,1.65));
  for(const site of placements){
    const key=site.model+'/'+site.rot;
    if(layouts.has(key))continue;
    const proto=paperPiece(assets,site.model),fold=createFoldInstance(proto,{tileId:site.model});
    proto.rotation.y=-Math.PI/2+rotToY(site.rot);
    const sweep=new THREE.Box3();
    for(const t of [1,.5,0]){fold.snap(t);sweep.union(bounds(proto));}
    const flat=bounds(proto),center=flat.getCenter(new THREE.Vector3());
    const side=Math.max(flat.max.x-flat.min.x,flat.max.z-flat.min.z,.2)*1.08;
    layouts.set(key,{key,proto,side,center,sweep,index:layouts.size});
  }
  const dim=Math.ceil(Math.sqrt(layouts.size)),pixels=Math.min(dim*144,renderer.capabilities.maxTextureSize);
  const target=new THREE.WebGLRenderTarget(pixels,pixels,{samples:0});
  target.texture.name='折平建筑实印';target.texture.colorSpace=THREE.SRGBColorSpace;
  target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
  for(const layout of layouts.values()){
    const {proto,center,side,index}=layout,col=index%dim,row=Math.floor(index/dim);
    proto.scale.setScalar(1/side);proto.position.set(col+.5-center.x/side,0,row+.5-center.z/side);
    scene.add(proto);
  }
  const camera=new THREE.OrthographicCamera(-dim/2,dim/2,dim/2,-dim/2,.1,100);
  camera.position.set(dim/2,45,dim/2);camera.up.set(0,0,-1);camera.lookAt(dim/2,0,dim/2);
  const oldTarget=renderer.getRenderTarget(),oldAlpha=renderer.getClearAlpha(),oldColor=renderer.getClearColor(new THREE.Color());
  renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
  renderer.setRenderTarget(oldTarget);renderer.setClearColor(oldColor,oldAlpha);
  for(const l of layouts.values()){l.proto.removeFromParent();delete l.proto;}
  return {layouts,dim,texture:target.texture};
}

export function createBoardBuildings({wfc,page,assets,renderer}){
  const domain=wfc.sheet,{layouts,dim,texture}=wfc.paperAssets?.flat??createFlatAtlas(renderer,assets,wfc.placements);
  const sites=[],panels=new Map(),active=new Map(),events=[];
  const atlasMaterial=new THREE.MeshBasicMaterial({map:texture,alphaTest:.23,side:THREE.DoubleSide});
  atlasMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec2 printOffset;\n'+shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvMapUv=(vMapUv+printOffset)/'+dim.toFixed(1)+';');
  };
  atlasMaterial.customProgramCacheKey=()=> 'closed-parcels-'+dim;
  for(const parcel of wfc.placements){
    const layout=layouts.get(parcel.model+'/'+parcel.rot),rect=parcel.sourceBounds;
    const [u,v]=domain.imageToPage(...parcel.sourceCentre);
    const corner0=domain.imageToPage(rect[0],rect[1]),corner1=domain.imageToPage(rect[0]+rect[2],rect[1]+rect[3]);
    const width=Math.abs(corner1[0]-corner0[0]),depth=Math.abs(corner1[1]-corner0[1]);
    const center=layout.sweep.getCenter(new THREE.Vector3()),size=layout.sweep.getSize(new THREE.Vector3());
    const band=parcelCaption(parcel,width,depth)?.band||0;
    const scale=Math.min(domain.step*2.9,(width-band)*.87/Math.max(.05,size.x),depth*.87/Math.max(.05,size.z));
    const part=page.part(u,v);
    const site={parcel,part,layout,scale,u:u-band/2-center.x*scale,v:v-center.z*scale,centre:[u,v]};
    if(!panels.has(part))panels.set(part,[]);
    site.slot=panels.get(part).push(site)-1;sites.push(site);
  }
  const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),size=new THREE.Vector3();
  function stamp(site,shown) {
    const {layout,part,scale,mesh}=site;
    pos.set(site.u-part.x+layout.center.x*scale,.32,site.v-part.z+layout.center.z*scale);
    size.setScalar(shown?layout.side*scale:0);mesh.setMatrixAt(site.slot,matrix.compose(pos,quat,size));mesh.instanceMatrix.needsUpdate=true;
  }
  for(const [part,group] of panels){
    const plane=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),offset=new Float32Array(group.length*2);
    const mesh=new THREE.InstancedMesh(plane,atlasMaterial,group.length);
    mesh.name='地块原位折平建筑';mesh.frustumCulled=false;mesh.receiveShadow=true;
    for(const s of group){
      offset[s.slot*2]=s.layout.index%dim;offset[s.slot*2+1]=dim-1-Math.floor(s.layout.index/dim);
      s.mesh=mesh;stamp(s,true);
    }
    plane.setAttribute('printOffset',new THREE.InstancedBufferAttribute(offset,2));part.node.add(mesh);
  }
  const served=new Map(),roads=wfc.roads;
  for(const s of sites){
    const [x,y,width,height]=s.parcel.sourceBounds;
    const distances=roads.map(r=>{
      const [px,py]=wfc.toPixel(r.x,r.z);
      return Math.hypot(Math.max(x-px,0,px-x-width),Math.max(y-py,0,py-y-height));
    });
    const closest=Math.min(...distances),limit=Math.max(wfc.plan.grid.pitch*.76,closest+.1);
    roads.forEach((r,i)=>{
      if(distances[i]>limit)return;
      const key=r.x+','+r.z;if(!served.has(key))served.set(key,[]);served.get(key).push(s);
    });
  }
  let lastCell='',clock=0;
  function show(site,road,source){
    const id=site.parcel.id;
    if(active.has(id))return active.get(id);
    const proto=paperPiece(assets,site.parcel.model);
    if(!proto)return null;
    const fold=createFoldInstance(proto,{tileId:site.parcel.model});
    const holder=new THREE.Group();holder.name='原位建筑 '+id;holder.rotation.y=-Math.PI/2+rotToY(site.parcel.rot);
    holder.position.set(site.u-site.part.x,.32,site.v-site.part.z);holder.scale.setScalar(site.scale);holder.add(proto);site.part.node.add(holder);
    fold.snap(0);fold.setTarget(1);stamp(site,false);
    const item={site,fold,holder,until:clock+1.8};active.set(id,item);
    events.push({id,model:site.parcel.model,road,time:clock,source});
    if(events.length>200)events.shift();return item;
  }
  let lastFocus=null,focused=[];
  function update(dt,road,unfolded,focus=null){
    clock+=dt;lastCell=road?road.x+','+road.z:'';
    if(unfolded){
      if(focus!==lastFocus){
        lastFocus=focus;focused=[];
        if(focus){
          const [wx,wz]=domain.toWorld(...focus),[px,py]=wfc.toPixel(wx/2,wz/2);
          const radius=wfc.plan.grid.pitch*1.55;
          focused=sites.filter(s=>{
            const [x,y,w,h]=s.parcel.sourceBounds;
            return Math.hypot(Math.max(x-px,0,px-x-w),Math.max(y-py,0,py-y-h))<=radius;
          });
        }
      }
      function approach(site,source){
        wfc.paperAssets?.stamp?.(site.layout.index);
        const item=show(site,source==='pawn'?lastCell:null,source);
        if(item){item.until=clock+1.8;if(!item.fold.target)item.fold.setTarget(1);}
      }
      for(const site of served.get(lastCell)||[])approach(site,'pawn');
      for(const site of focused)approach(site,'camera');
    }
    for(const [id,item] of active){
      if(!unfolded||clock>item.until)item.fold.setTarget(0);
      item.fold.update(dt);
      if(!item.fold.target&&item.fold.progress<.006){item.holder.removeFromParent();stamp(item.site,true);active.delete(id);}
    }
  }
  return {update,snapshot:()=>({registered:sites.length,flat:sites.length-active.size,atlasPrototypes:layouts.size,road:lastCell,
    active:[...active].map(([id,r])=>({id,name:r.site.parcel.label,fold:r.fold.progress,target:r.fold.target})),events:events.slice(-40)}),
    locations:()=>sites.map(s=>({id:s.parcel.id,centre:s.centre,source:s.parcel.sourceCentre,bounds:s.parcel.sourceBounds})),
    serving:(x,z)=>(served.get(x+','+z)||[]).map(s=>s.parcel.id)};
}
