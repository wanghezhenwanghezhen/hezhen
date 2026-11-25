import * as THREE from 'three';
import { createPaperProjection } from '../world/paper-projection.js';
import { createFoldedSheet } from '../world/sheet-fold.js';
import { createFoldInstance } from '../world/fold.js';
import { rotToY } from '../core/models.js';
import { createPost } from '../render/post.js';

const clamp=(v,l=0,h=1)=>Math.max(l,Math.min(h,v));
export function createPaperSheet({wfc,assets,renderer,quality,traveller,world,follow,controls,guide,prepareStreet}){
  const domain=wfc.sheet,page=createFoldedSheet(wfc);
  wfc.streetScenery?.attachSheet(page);
  const calibrateProjection=createPaperProjection(page.terrainInfo().peakWorld);
  const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.12,500);camera.userData.citySheetOverview=true;
  const post=createPost({renderer,scene:page.scene,camera,quality});post.enabled=false;
  const dial=document.querySelector('#fold-dial'),foldButton=document.querySelector('#fold-action'),modeButton=document.querySelector('#sheet-mode'),reset=document.querySelector('#sheet-reset'),caption=document.querySelector('#sheet-place'),bar=document.querySelector('#sheet-tools');
  const params=new URLSearchParams(window.location.search),startFold=params.has('fold')?clamp(Number(params.get('fold'))||0):0;
  let mode='sheet',progress=startFold,target=startFold,clock=0,auto=!params.has('fold'),span=[0,0,0],lastPose=-1;
  // Advance the entrance only after the closed paper has been presented in a
  // visible tab. GPU setup, background rAF ticks and asset loading do not count.
  const openDuration=4.65;
  let shownFrames=0,openingTime=0;
  const openingPhase=()=>!auto?(progress===1?'open':'manual'):(shownFrames<2?'first-frame':'opening');
  document.addEventListener('visibilitychange',()=>{if(document.hidden)shownFrames=0;});
  let selected=null,zoom=0,zoomGoal=0,inspected=null,anchorLabel='',trail=false;
  const aim=new THREE.Vector3(),aimTarget=new THREE.Vector3(),camOffset=new THREE.Vector3(),ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
  const up=new THREE.Vector3(0,1,0);
  const live=new Map(), keys=new Set(), events=[],sourceStats={player:0,camera:0};
  const seeds=new Map(),byCell=new Map();
  function seed(x,z,model,rot,parcel,kind){
    const id=x+','+z;if(seeds.has(id))return;
    const [u,v]=domain.toPage(2*x,2*z);
    const row={x,z,model,rot,id,parcel,kind,u,v};seeds.set(id,row);byCell.set(id,row);
  }
  for(const r of wfc.placements)seed(...r.anchor,r.runtimeModel,r.rot,r.id,r.kind);
  for(const r of domain.deco)seed(r.x,r.z,r.model,r.rot,r.parcel,r.kind);
  function acquire(s){
    const proto=assets.getTilePrototype(s.model).clone(true);
    const base=[];proto.traverse(o=>{if(o.isMesh&&/^base/i.test(o.name))base.push(o);});for(const b of base)b.visible=false;
    const fold=createFoldInstance(proto,{tileId:s.model});fold.snap(0);
    const part=page.part(s.u,s.v), holder=new THREE.Group();holder.name='popup-'+(s.parcel||s.id);
    holder.position.set(s.u-part.x,.3+page.height(s.u,s.v),s.v-part.z);holder.rotation.y=-Math.PI/2+rotToY(s.rot);holder.scale.setScalar(domain.step);
    holder.add(proto);part.node.add(holder);
    const row={s,holder,proto,fold,reasons:[]};live.set(s.id,row);return row;
  }
  const pawn=assets.traveller.clone(true);pawn.name='paper-traveller';const pawnRoot=new THREE.Group();pawnRoot.scale.setScalar(domain.step*1.8);pawnRoot.add(pawn);
  function updatePawn(){
    const [u,v]=domain.toPage(traveller.position.x,traveller.position.z),part=page.part(u,v);
    if(pawnRoot.parent!==part.node)part.node.add(pawnRoot);
    pawnRoot.position.set(u-part.x,.45+page.height(u,v),v-part.z);
    pawnRoot.rotation.y=-Math.PI/2+Math.atan2(traveller.moveDir.x,traveller.moveDir.z);
    pawnRoot.visible=progress>.68;
  }
  function setMode(m){
    mode=m;document.body.dataset.paperMode=mode;
    modeButton.textContent=mode==='sheet'?'进入街区':'查看整张';
    modeButton.setAttribute('aria-label',mode==='sheet'?'进入街区':'查看整张');
    keys.clear();controls.clearTarget();
    if(mode==='street'){follow.snap(traveller);camera.userData.citySheetOverview=true;}
  }
  let entering=false,streetAvailable=false;
  async function enterStreet(){
    if(entering)return;
    if(streetAvailable){setMode('street');return;}
    entering=true;modeButton.disabled=true;modeButton.textContent='正在准备街区…';
    try{
      await prepareStreet();streetAvailable=true;setMode('street');
    }catch(error){
      console.error('[street]',error);modeButton.textContent='重新进入街区';caption.textContent='街区加载失败';
    }finally{entering=false;modeButton.disabled=false;}
  }
  function setFold(value,instant=false){auto=false;target=clamp(value);if(instant)progress=target;foldButton.textContent=target>.48?'收起纸页':'摊开纸页';}
  function margin(u,v){const [a,b,c,d]=page.plain;return u<a||u>c||v<b||v>d;}
  function updateModeButton(){
    if(entering)return;
    const uv=selected||domain.toPage(traveller.position.x,traveller.position.z);
    const label=mode==='street'?'查看整张':trail?'返回全幅':margin(...uv)?'沿纸坡行走':'进入街区';
    modeButton.textContent=label;modeButton.setAttribute('aria-label',label);
  }
  function activateView(u,v){
    if(domain.distanceUV(u,v)<0)return false;
    trail=false;selected=[u,v];inspected=domain.toWorld(u,v);zoomGoal=1;updateModeButton();
    const cx=inspected[0]/2,cz=inspected[1]/2;
    const nearest=wfc.placements.reduce((a,b)=>Math.hypot(cx-a.anchor[0],cz-a.anchor[1])<Math.hypot(cx-b.anchor[0],cz-b.anchor[1])?a:b);
    anchorLabel=Math.hypot(cx-nearest.anchor[0],cz-nearest.anchor[1])<3.1?nearest.label:'纸坡景观';caption.textContent=anchorLabel;
    if(progress<.97)setFold(1);return true;
  }
  function clearView(){trail=false;selected=null;inspected=null;zoomGoal=0;caption.textContent='';anchorLabel='';updateModeButton();}
  function replayOpening(){
    setMode('sheet');clearView();setFold(0,true);
    shownFrames=0;openingTime=0;auto=true;
  }
  document.querySelector('#sheet-replay').addEventListener('click',replayOpening);
  function changeView(){
    if(mode==='street'||trail){setMode('sheet');setFold(1);clearView();return;}
    const uv=selected||domain.toPage(traveller.position.x,traveller.position.z);
    if(inspected){let [x,z]=inspected,legal=traveller.canPass(x,z);
      for(let rad=.2;!legal&&rad<3;rad+=.2)for(let i=0;i<20&&!legal;i++){const a=i*Math.PI/10,xx=inspected[0]+Math.cos(a)*rad,zz=inspected[1]+Math.sin(a)*rad;if(traveller.canPass(xx,zz)){x=xx;z=zz;legal=true;}}
      if(!legal){caption.textContent='此处无落脚点，请点选附近草坡';return;}
      traveller.teleport(x,z);
    }
    if(margin(...uv)){
      trail=true;inspected=null;setFold(1);zoomGoal=1.36;anchorLabel='纸坡步行';caption.textContent=anchorLabel;updateModeButton();return;
    }
    enterStreet();
  }
  modeButton.onclick=changeView;
  foldButton.onclick=()=>{if(mode!=='sheet')setMode('sheet');setFold(target>.5?0:1);clearView();};
  dial.oninput=()=>{if(mode!=='sheet')setMode('sheet');setFold(Number(dial.value)/100,true);};
  reset.onclick=clearView;
  for(const id of ['guide-travel','guide-street'])document.querySelector('#'+id).addEventListener('click',()=>{enterStreet();clearView();});
  const canvas=renderer.domElement;
  function picked(e){
    const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObjects(page.pick,false)[0];return hit?.uv?[hit.uv.x*1080,(1-hit.uv.y)*680]:null;
  }
  let down=null;
  canvas.addEventListener('pointerdown',e=>{if(mode==='sheet'){e.stopImmediatePropagation();canvas.focus({preventScroll:true});down=[e.clientX,e.clientY];}},{capture:true});
  window.addEventListener('pointerup',e=>{
    if(mode!=='sheet'||!down)return;const d=down;down=null;if(Math.hypot(e.clientX-d[0],e.clientY-d[1])>12)return;
    const uv=picked(e);if(uv)activateView(...uv);
  },{capture:true});
  canvas.addEventListener('wheel',e=>{if(mode!=='sheet')return;e.preventDefault();if(e.deltaY<0){if(!selected){const uv=picked(e);if(uv)activateView(...uv);}else zoomGoal=clamp(zoomGoal+Math.max(.16,Math.min(.5,-e.deltaY/440)),1,2.4);}else if(selected&&zoomGoal>1.05){zoomGoal=Math.max(1,zoomGoal-Math.max(.22,e.deltaY/440));}else clearView();},{passive:false});
  window.addEventListener('keydown',e=>{if(mode!=='sheet'||guide.modal()||(e.target.matches('select')||(e.target.matches('input')&&e.code.startsWith('Arrow'))))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();}
    if(e.code==='Escape'){clearView();e.preventDefault();}
    if(e.code==='Tab'){e.preventDefault();e.stopImmediatePropagation();changeView();}
  },{capture:true});
  window.addEventListener('keyup',e=>keys.delete(e.code),{capture:true});window.addEventListener('blur',()=>keys.clear());
  function playerInput(){
    let x=Number(keys.has('KeyA')||keys.has('ArrowLeft'))-Number(keys.has('KeyD')||keys.has('ArrowRight'));
    let z=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const length=Math.hypot(x,z);if(length){const s=keys.has('ShiftLeft')||keys.has('ShiftRight')?1.5:1;x=x/length*s;z=z/length*s;}
    return progress>.8?{x,z}:{x:0,z:0};
  }
  function updatePops(dt){
    const px=traveller.position.x/2,pz=traveller.position.z/2, wants=new Map();
    function gather(x,z,r,why){
      const R=Math.ceil(r);
      for(let i=Math.round(x)-R;i<=Math.round(x)+R;i++)for(let j=Math.round(z)-R;j<=Math.round(z)+R;j++){
        const s=byCell.get(i+','+j);if(!s||Math.hypot(x-i,z-j)>r)continue;
        const reasons=wants.get(s.id)||[];reasons.push(why);wants.set(s.id,reasons);
      }
    }
    if(progress>.97){gather(px,pz,3.42,'player');if(inspected&&zoom>.14)gather(inspected[0]/2,inspected[1]/2,3.48,'camera');}
    for(const [id,reasons] of wants){
      const l=live.get(id)||acquire(seeds.get(id));
      if(!l.fold.target){l.fold.setTarget(1,.06);events.push({type:'rise',id,model:l.s.model,reasons:[...reasons],time:clock});}
      l.reasons=reasons;
    }
    sourceStats.player=0;sourceStats.camera=0;
    for(const [id,l] of live){
      if(!wants.has(id)){if(l.fold.target)events.push({type:'fall',id,model:l.s.model,reasons:l.reasons,time:clock});l.fold.setTarget(0);l.reasons=[];}
      l.holder.position.y=.3+page.height(l.s.u,l.s.v);
      l.fold.update(dt);
      for(const reason of l.reasons)sourceStats[reason]++;
      if(!l.fold.target&&l.fold.progress<.005){l.holder.removeFromParent();live.delete(id);}
    }
    if(events.length>220)events.splice(0,events.length-220);
  }
  function update(dt){
    clock+=dt;
    if(mode!=='sheet')return;
    if(auto){
      if(!document.hidden && shownFrames>=2){
        openingTime+=dt;
        // A brief readable closed pose, then a continuous lift. The hills
        // have their own folds driven by this same paper progress.
        const t=clamp((openingTime-.28)/openDuration);
        target=1;
        progress=t*t*(3-2*t);
        foldButton.textContent='收起纸页';
        if(t>=1)auto=false;
      }
    }else if(target!==progress){
      const step=dt*.32;
      progress+=Math.sign(target-progress)*Math.min(Math.abs(target-progress),step);
    }
    if(lastPose!==progress){span=page.pose(progress);lastPose=progress;dial.value=Math.round(progress*100);}
    zoom+= (zoomGoal-zoom)*(1-Math.exp(-5*dt));
    if(trail)selected=domain.toPage(traveller.position.x,traveller.position.z);
    const point=selected&&progress>.53?page.worldAt(...selected,aimTarget):aimTarget.set(0,0,0);
    const approach=Math.min(1,zoom),detail=Math.max(0,zoom-1);
    const look=aim.copy(point).multiplyScalar(approach);look.z+=(1-approach)*1.8;look.y+=approach*.16+(1-approach)*span[1]*.48*(1-THREE.MathUtils.smoothstep(progress,.74,.97));
    const unfolded=THREE.MathUtils.smoothstep(progress,.05,.94);
    const overviewSize=Math.max(35+43*unfolded,(span[0]+4)*1.18/Math.max(.4,camera.aspect),(span[2]*.94+span[1]*.49)*1.14+6);
    const targetSize=THREE.MathUtils.lerp(overviewSize,56,approach);
    const dist=targetSize/(2*Math.tan(Math.PI/10))/(1+8*zoom+2.8*zoom*zoom);
    const sideView=Math.sin(Math.PI*THREE.MathUtils.smoothstep(progress,.68,1))*(1-approach);
    camOffset.set(.055+.16*sideView-.63*approach-.20*detail,.76+.25*unfolded-.18*sideView-.43*approach-.12*detail,.66-.28*unfolded+.31*sideView+.18*approach+.06*detail);
    camOffset.applyAxisAngle(up,-Math.PI*.5*approach).normalize().multiplyScalar(dist);
    camera.position.copy(look).add(camOffset);
    if(zoom>.48&&progress>.995){
      let lift=0;
      // The eye and entire eye-to-target segment stay above the identically sampled folded surface.
      for(let step=1;step<=14;step++){
        const t=step/14,x=look.x+camOffset.x*t,y=look.y+camOffset.y*t,z=look.z+camOffset.z*t;
        lift=Math.max(lift,(page.heightAtWorldXZ(x,z)+.065+.08*t-y)/t);
      }
      camera.position.y+=lift;
    }
    camera.lookAt(look);camera.updateMatrixWorld(true);
    calibrateProjection(camera,THREE.MathUtils.smoothstep(progress,.88,1)*(1-approach));
    if(approach<.01&&progress>0&&progress<.995){
      for(let i=0;i<3;i++){
        const extent=page.maxViewportCoordinate(camera);if(extent<=.915)break;
        camera.position.sub(look).multiplyScalar(extent/.905).add(look);camera.updateMatrixWorld(true);
      }
    }
    updatePawn();updatePops(dt);
    wfc.streetScenery?.updateSheet(dt,traveller.position.x,traveller.position.z,inspected,zoom,progress);
    reset.hidden=!selected||trail;
    document.querySelector('#sheet-tip').hidden=!!selected||guide.modal();
  }
  function snapshot(){
    const uv=domain.toPage(traveller.position.x,traveller.position.z),feet=pawnRoot.getWorldPosition(new THREE.Vector3()),surface=page.worldAt(...uv);
    return {mode,progress,target,span,trail:{active:trail,uv,foot:feet.toArray(),surface:surface.toArray(),eyeGroundGap:progress>.995?camera.position.y-page.heightAtWorldXZ(camera.position.x,camera.position.z):null},roadBake:!!wfc.print.roadInk,registeredLandmarks:wfc.placements.filter(p=>p.usage==='dedicated-candidate').length,outline:domain.metadata.bounds,areaIoU:domain.metadata.intersectionOverUnion,terrain:page.terrainInfo(),panels:page.faceCount,panelTriangles:page.triangles,fit:OUTLINE_INFO(),deco:domain.deco.length,landUse:seeds.size,
      opening:{phase:openingPhase(),visibleFrames:shownFrames,visibleSeconds:openingTime},player:[traveller.position.x,traveller.position.z],cameraFocus:inspected,cameraZoom:zoom,streetAvailable,entering,localSources:{...sourceStats},focusLabel:anchorLabel,
      columnAngles:page.parts.map(p=>p[1].node.parent.rotation.z),rowAngles:page.parts[3].map(p=>p.node.rotation.x),cameraPosition:camera.position.toArray(),
      local:[...live.values()].map(({s,fold,reasons})=>({id:s.id,parcel:s.parcel,kind:s.kind,model:s.model,reasons:[...reasons],progress:fold.progress,target:fold.target})),events:events.slice(-75)};
  }
  function OUTLINE_INFO(){return domain.metadata.fit;}
  function screenBox(parcel){
    const piece=[...live.values()].find(r=>r.s.parcel===parcel);
    if(!piece)return null;
    const points=[],p=new THREE.Vector3();
    piece.holder.updateWorldMatrix(true,true);
    piece.holder.traverseVisible(o=>{
      if(!o.isMesh)return;
      const attr=o.geometry.getAttribute('position');
      for(let i=0;i<attr.count;i++){p.fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld).project(camera);
        if(p.z>=-1&&p.z<=1)points.push([(p.x+1)*innerWidth/2,(1-p.y)*innerHeight/2]);}
    });
    if(!points.length)return null;
    return {left:Math.min(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1])),visibleVertices:points.length};
  }
  window.paperSheet={snapshot,screenBox,hit:(x,y)=>picked({clientX:x,clientY:y}),projectedBounds:()=>{
    const points=[],v=new THREE.Vector3();for(const mesh of page.pick){const n=mesh.geometry.attributes.position.count;
      for(let i=0;i<n;i++){mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld).project(camera);points.push([(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2]);}}
    return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  },height:(u,v)=>page.height(u,v),surfacePoint:(u,v)=>page.worldAt(u,v).toArray(),project:(u,v)=>{const p=page.worldAt(u,v).project(camera);return [(p.x+1)*innerWidth/2,(1-p.y)*innerHeight/2];},
    outline:()=>domain.polygon,probe:(u,v)=>{const [x,z]=domain.toWorld(u,v);const a=domain.mask.image.getContext('2d').getImageData(Math.max(0,Math.min(1079,Math.floor(u))),Math.max(0,Math.min(679,Math.floor(v))),1,1).data[3];return {world:[x,z],signedPx:domain.distanceUV(u,v),maskAlpha:a,playerCanStand:traveller.canPass(x,z)};},mapPoint:(x,z)=>domain.toPage(x,z),diagnostics:()=>({used:domain.used.length,finiteCells:domain.cells.size})};
  setMode(mode);if(!auto)setFold(startFold,true);
  return {get mode(){return mode;},playerInput,update,enterStreet,render(dt){
    post.setFocus(aim);post.render(dt);
    if(!document.hidden && document.body.classList.contains('ready'))shownFrames=Math.min(2,shownFrames+1);
  },resize(w,h){camera.aspect=w/h;camera.updateProjectionMatrix();post.setSize(w,h);},page};
}
