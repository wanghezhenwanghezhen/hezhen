import * as THREE from 'three';
const arc=Math.PI/2;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const length2=(x,z)=>Math.hypot(x,z);
function printGeometry(index,columns=8,rows=10) {
  const geom=new THREE.PlaneGeometry(1,1);
  geom.translate(0,.5,0);
  const uv=geom.getAttribute('uv'),cx=index%columns,cy=Math.floor(index/columns);
  for(let i=0;i<uv.count;i++) uv.setXY(i,(cx+(3.5+121*uv.getX(i))/128)/columns,1-(cy+(3.5+121*(1-uv.getY(i)))/128)/rows);
  return geom;
}
function createView(scene,placements,prints,material,page,wfc) {
  const root=new THREE.Group();root.name=page?'街景纸片·整图':'街景纸片·街区';scene.add(root);
  const groups=new Map(),states=placements.map(p=>({p,fold:0})),counters={visible:0,standing:0,byModel:{},near:[]};
  for(const p of placements) {
    if(!groups.has(p.model)) groups.set(p.model,{count:0,used:0});
    groups.get(p.model).count++;
  }
  for(const [key,g] of groups) {
    g.meshes=prints[key].map(geo=>{
      const mesh=new THREE.InstancedMesh(geo,material,g.count);
      mesh.name=key;mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);return mesh;
    });
  }
  const pivot=new THREE.Object3D(),panel=new THREE.Object3D(),mat=new THREE.Matrix4();
  for(const row of states) {
    if(!page)continue;
    row.uv=wfc.sheet.toPage(row.p.x,row.p.z);row.part=page.part(...row.uv);
  }
  function update(dt,x,z,inspect,zoom,progress) {
    counters.visible=0;counters.standing=0;counters.byModel={};counters.near=[];
    for(const g of groups.values())g.used=0;
    for(const row of states) {
      const p=row.p;
      const dist=Math.min(length2(x-p.x,z-p.z),inspect&&zoom>.14?length2(inspect[0]-p.x,inspect[1]-p.z):Infinity);
      const target=progress>.97?clamp((8.0-dist)/2.4,0,1):0;
      row.fold+=(target-row.fold)*(1-Math.exp(-Math.min(.18,Math.max(0,dt))*5.7));
      if(row.fold<.012 || progress<.78)continue;
      const g=groups.get(p.model),i=g.used++,f=row.fold;
      const s=page?wfc.sheet.step:1;
      pivot.scale.setScalar(s);pivot.rotation.set(0,p.yaw+(page?-arc:0),0);
      if(page) {
        const [u,v]=row.uv,part=row.part;
        pivot.position.set(u-part.x,page.height(u,v)+.16,v-part.z);pivot.updateMatrix();mat.multiplyMatrices(part.node.matrixWorld,pivot.matrix);
      }else{pivot.position.set(p.x,.028,p.z);pivot.updateMatrix();mat.copy(pivot.matrix);}
      for(let side=0;side<2;side++) {
        const rise=side===0?f:clamp((f-.055)/.945,0,1);
        panel.rotation.order='YXZ';panel.rotation.set(-arc*(1-rise),side*arc,0,'YXZ');
        // Emerge through a scored ground slit before rotating completely upright.
        // r*(1-cos(r*pi/2)) has less lateral reach than folding a free-standing full-height card.
        panel.scale.set(side?p.depth:p.width,p.height*rise*rise,1);panel.updateMatrix();
        const matrix=g.meshes[side].userData.workMatrix ||= new THREE.Matrix4();
        g.meshes[side].setMatrixAt(i,matrix.multiplyMatrices(mat,panel.matrix));
      }
      counters.visible++;if(f>.88)counters.standing++;
      counters.byModel[p.model]=(counters.byModel[p.model]||0)+1;
      if(counters.near.length<32)counters.near.push({id:p.id,model:p.model,fold:+f.toFixed(2),parcel:p.parcel,x:+p.x.toFixed(2),z:+p.z.toFixed(2)});
    }
    for(const g of groups.values())for(const m of g.meshes){m.count=g.used;m.visible=g.used>0;if(g.used)m.instanceMatrix.needsUpdate=true;}
  }
  function dispose(){
    root.removeFromParent();
    root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
  }
  return {update,counters,dispose};
}
export function createPrintedStreetView(wfc,data,texture){
  const placements=data.placements;
  const material=new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide,alphaTest:.49,flatShading:true});
  const prints=Object.fromEntries(Object.entries(data.plates).map(([k,v])=>[k,v.views.map(i=>printGeometry(i,data.cols,data.rows))]));
  const byModel={},bySide={'-1':0,'1':0};
  for(const p of placements){byModel[p.model]=(byModel[p.model]||0)+1;bySide[p.side]++;}
  let street,sheet;
  return {
    attachStreet(scene){street ||= createView(scene,placements,prints,material,null,wfc);},
    attachSheet(page){sheet ||= createView(page.scene,placements,prints,material,page,wfc);},
    updateStreet(dt,x,z){street?.update(dt,x,z,null,0,1);},
    updateSheet(dt,x,z,inspected,zoom,progress){sheet?.update(dt,x,z,inspected,zoom,progress);},
    dispose(){sheet?.dispose();street?.dispose();for(const pair of Object.values(prints))for(const geometry of pair)geometry.dispose();material.dispose();texture.dispose();},
    placements(){return placements.map(p=>({...p}));},
    diagnostics(){return {prototypes:Object.keys(prints).length,sourcePreset:data.preset,total:placements.length,sourceRecords:data.records,byModel,bySide,minimumRoadClearance:Math.min(...placements.map(p=>p.roadClearance)),minimumLandmarkApproachClearance:Math.min(...placements.map(p=>p.doorClearance)),textureReady:!!texture.image?.width,street:street?.counters,sheet:sheet?.counters};}
  };
}

