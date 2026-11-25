import * as THREE from 'three';
import { createPaperProjection } from '../world/paper-projection.js';
import { boardShot } from './board-presentation.js';

export function createBoardCamera({page,canvas,onTap,onGesture}){
  const camera=new THREE.PerspectiveCamera(36,1,.12,500);camera.userData.citySheetOverview=true;
  const calibrate=createPaperProjection(page.terrainInfo().peakWorld);
  const up=new THREE.Vector3(0,1,0),look=new THREE.Vector3(),offset=new THREE.Vector3(),pan=new THREE.Vector3();
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),plane=new THREE.Plane(up,0);
  const pointers=new Map();
  let zoom=1,yaw=0,pitch=0,pose=0,span=[20,8,12],drag=null,pinch=null,pairFrame=0;
  let fitKey='',fitDistance=1,focusX=.5,focusY=.5,lastFocusKey='',focusUV=null;
  const home=new THREE.Vector3();
  let shot=null,shotFit=null,manualShift=0;
  const shotOffset=new THREE.Vector3(),sightPoint=new THREE.Vector3();
  function shiftLens(amount){
    if(camera.projectionMatrix.elements[9]===amount)return;
    camera.projectionMatrix.elements[9]=amount;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  function shotLook(out,azimuth,blend){
    return out.set(boardShot.targetOffsetX,0,boardShot.targetOffsetZ)
      .applyAxisAngle(up,azimuth-boardShot.destinationYaw).multiplyScalar(blend).add(home);
  }
  function pointCamera(direction,distance,target){
    camera.position.copy(target).addScaledVector(direction,distance);
    camera.lookAt(target);camera.updateMatrixWorld(true);
  }
  function fullOpenDirection(out,azimuth,tilt){
    const bearing=Math.atan2(.055,.38)+azimuth;
    const angle=Math.atan2(Math.hypot(.055,.38),1.01)+tilt;
    return out.set(Math.sin(angle)*Math.sin(bearing),Math.cos(angle),Math.sin(angle)*Math.cos(bearing));
  }
  function measureShot(baseSize){
    if(shotFit?.aspect===camera.aspect)return shotFit;
    const width=window.frameElement?.getBoundingClientRect().width||canvas.clientWidth;
    const hostWidth=window.frameElement?.ownerDocument.documentElement.clientWidth||width;
    const ratio=hostWidth<768?boardShot.narrowWidth:Math.min(.93,boardShot.desktopWidth*hostWidth/width);
    calibrate(camera,1);
    fullOpenDirection(shotOffset,boardShot.openingYaw,0);
    let start=baseSize/(2*Math.tan(Math.PI/10));
    for(let i=0;i<3;i++){
      pointCamera(shotOffset,start,home);
      const extent=page.maxViewportCoordinate(camera);if(extent<=.915)break;
      start*=extent/.905;
    }
    start/=boardShot.openingScale;
    fullOpenDirection(shotOffset,boardShot.destinationYaw,boardShot.destinationPitch);
    shotLook(sightPoint,boardShot.destinationYaw,1);
    let low=20,high=Math.max(260,start*1.5);
    for(let i=0;i<15;i++){
      const mid=(low+high)/2;pointCamera(shotOffset,mid,sightPoint);
      const b=page.projectedBounds(camera);
      if((b.right-b.left)/2>ratio)low=mid;else high=mid;
    }
    // Reserve the envelope of a whole turn once. A constant lens shift uses
    // the clear space below the board and keeps the camera radius fixed.
    let shift=0;
    for(let attempt=0;attempt<4;attempt++){
      let top=-Infinity,bottom=Infinity,side=0;
      for(let n=0;n<36;n++){
        const a=boardShot.destinationYaw+n*Math.PI/18;
        fullOpenDirection(shotOffset,a,boardShot.destinationPitch);
        pointCamera(shotOffset,high,shotLook(sightPoint,a,1));
        const b=page.projectedBounds(camera);
        top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);side=Math.max(side,-b.left,b.right);
      }
      shift=THREE.MathUtils.clamp(0,top-.966,bottom+.966);
      const overflow=Math.max(side/.966,(top-bottom)/1.932);
      if(overflow<=1)break;
      high*=overflow*1.005;
    }
    return shotFit={aspect:camera.aspect,ratio,start,end:high,shift};
  }
  function setRay(x,y){
    const r=canvas.getBoundingClientRect();ndc.set((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2);
    ray.setFromCamera(ndc,camera);return ray;
  }
  function hit(x,y){
    setRay(x,y);return ray.intersectObjects(page.pick,false)[0]||null;
  }
  function pick(x,y){
    const a=hit(x,y);return a?.uv?[a.uv.x*1080,(1-a.uv.y)*680]:null;
  }
  function anchor(x,y){
    return hit(x,y)?.point || ray.ray.intersectPlane(plane,new THREE.Vector3()) || look.clone();
  }
  function frame(progress=pose,size=span){
    span=size;pose=progress;
    const unfolded=THREE.MathUtils.smoothstep(pose,.05,.94);
    const baseSize=Math.max(35+43*unfolded,(span[0]+4)*1.18/Math.max(.32,camera.aspect),(span[2]*.94+span[1]*.49)*1.14+6);
    const swing=Math.sin(Math.PI*THREE.MathUtils.smoothstep(pose,.68,1));
    home.set(0,span[1]*.48*(1-THREE.MathUtils.smoothstep(pose,.74,.97)),1.8);
    look.copy(home).add(pan);
    if(shot && pose===1){
      const fit=measureShot(baseSize);
      const distance=THREE.MathUtils.lerp(fit.start,fit.end,shot.blend);
      zoom=fit.start*boardShot.openingScale/distance;
      shiftLens(THREE.MathUtils.lerp(-boardShot.openingLift,fit.shift,shot.blend));
      fullOpenDirection(offset,yaw,pitch);
      shotLook(look,yaw,shot.blend);
      pointCamera(offset,distance,look);return;
    }
    offset.set(.055+.16*swing,.76+.25*unfolded-.18*swing,.66-.28*unfolded+.31*swing);
    if(pitch){
      const horizontal=Math.hypot(offset.x,offset.z);
      const angle=THREE.MathUtils.clamp(Math.atan2(horizontal,offset.y)+pitch,.09,1.05);
      offset.set(offset.x/horizontal*Math.sin(angle),Math.cos(angle),offset.z/horizontal*Math.sin(angle));
    }
    offset.normalize().applyAxisAngle(up,yaw);
    const key=pose+'|'+yaw+'|'+pitch+'|'+camera.aspect+'|'+baseSize;
    if(fitKey!==key){
      fitKey=key;fitDistance=baseSize/(2*Math.tan(Math.PI/10));
      camera.position.copy(home).addScaledVector(offset,fitDistance);camera.lookAt(home);camera.updateMatrixWorld(true);
      calibrate(camera,THREE.MathUtils.smoothstep(pose,.88,1));
      shiftLens(manualShift);
      for(let i=0;i<3;i++){
        const extent=page.maxViewportCoordinate(camera);if(extent<=.915)break;
        fitDistance*=extent/.905;camera.position.copy(home).addScaledVector(offset,fitDistance);camera.updateMatrixWorld(true);
      }
    }
    if(shot){zoom=boardShot.openingScale;shiftLens(-boardShot.openingLift);}
    camera.position.copy(look).addScaledVector(offset,fitDistance/zoom);camera.lookAt(look);camera.updateMatrixWorld(true);
  }
  function zoomAt(x,y,factor){
    if(pose<.995)return;
    const next=THREE.MathUtils.clamp(zoom*factor,1,6);
    if(next===zoom)return;
    const r=canvas.getBoundingClientRect();
    focusX=(x-r.left)/r.width;focusY=(y-r.top)/r.height;
    const origin=anchor(x,y),shift=1-zoom/next;
    pan.addScaledVector(origin.sub(look),shift);
    zoom=next;if(zoom===1)pan.set(0,0,0);frame();
  }
  function rotate(angle,progress=pose,size=span){yaw=(yaw+angle)%(2*Math.PI);frame(progress,size);}
  function orbit(gesture,x,y){
    const dx=x-gesture.x,dy=y-gesture.y;
    if(!gesture.moving&&Math.hypot(dx,dy)<=3)return;
    gesture.moving=true;gesture.x=x;gesture.y=y;
    yaw=(yaw-dx*.006)%(2*Math.PI);
    pitch=THREE.MathUtils.clamp(pitch-dy*.004,-.25,.67);
  }
  function present(sample,progress,size){
    shot=sample;yaw=sample.yaw;pitch=sample.pitch;frame(progress,size);
  }
  function releaseShot(){
    if(!shot)return;
    const distance=camera.position.distanceTo(look);
    pan.copy(look).sub(home);
    manualShift=camera.projectionMatrix.elements[9];
    shot=null;fitKey='';frame();
    zoom=fitDistance/distance;frame();
  }
  function reset(){shot=null;shotFit=null;manualShift=0;fitKey='';zoom=1;yaw=0;pitch=0;pan.set(0,0,0);frame();}
  function pair(){const [a,b]=[...pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.max(2,Math.hypot(a.x-b.x,a.y-b.y)),a:Math.atan2(b.y-a.y,b.x-a.x)};}
  // Both fingers report separately. Use their latest positions together so a
  // parallel swipe doesn't momentarily register as a pinch on every event.
  function applyPair(){
    pairFrame=0;
    if(!pinch||pointers.size!==2)return;
    const next=pair(),last=pinch.last;
    const twist=last.a-next.a;
    yaw+=Math.atan2(Math.sin(twist),Math.cos(twist));
    orbit(pinch,next.x,next.y);
    frame();
    const distance=Math.abs(next.d-pinch.startDistance)<2 ? pinch.startDistance : next.d;
    zoomAt(next.x,next.y,(pinch.startZoom*distance/pinch.startDistance)/zoom);
    pinch.last=next;
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    if((e.button!==0&&e.button!==2)||pointers.size>=2)return;
    onGesture();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1)drag={x:e.clientX,y:e.clientY,travel:0,pan:e.button===2||e.shiftKey,ignore:e.button===2};
    if(pointers.size===2){const last=pair();pinch={x:last.x,y:last.y,last,startDistance:last.d,startZoom:zoom};drag=null;}
  });
  canvas.addEventListener('pointermove',e=>{
    const point=pointers.get(e.pointerId);if(!point)return;
    const dx=e.clientX-point.x,dy=e.clientY-point.y;
    point.x=e.clientX;point.y=e.clientY;
    if(pointers.size===2&&pinch){
      if(!pairFrame)pairFrame=requestAnimationFrame(applyPair);
      return;
    }
    if(!drag)return;
    drag.travel+=Math.hypot(dx,dy);
    if(drag.travel<=3)return;
    if(drag.pan){if(zoom>1){pan.add(anchor(e.clientX-dx,e.clientY-dy).sub(anchor(e.clientX,e.clientY)));frame();}}
    else{orbit(drag,e.clientX,e.clientY);frame();}
  });
  function stop(e,allowTap){
    if(!pointers.has(e.pointerId))return;
    if(pairFrame){cancelAnimationFrame(pairFrame);applyPair();}
    pointers.delete(e.pointerId);
    if(allowTap&&drag&&!drag.ignore&&drag.travel<=3&&pose>.97)onTap(setRay(e.clientX,e.clientY),pick(e.clientX,e.clientY));
    const remaining=pointers.values().next().value;
    drag=remaining?{...remaining,travel:0,pan:false,ignore:true}:null;pinch=null;
  }
  canvas.addEventListener('pointerup',e=>stop(e,true));
  canvas.addEventListener('pointercancel',e=>stop(e,false));
  canvas.addEventListener('lostpointercapture',e=>stop(e,false));
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();onGesture();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);
    zoomAt(e.clientX,e.clientY,Math.exp(-THREE.MathUtils.clamp(delta,-450,450)*.0017));
  },{passive:false});
  function project(u,v){
    const p=page.worldAt(u,v).project(camera),r=canvas.getBoundingClientRect();
    return [r.left+(p.x+1)*r.width/2,r.top+(1-p.y)*r.height/2];
  }
  function reveal(u,v){
    if(zoom<=1)return;
    focusX=.5;focusY=.5;const pt=page.worldAt(u,v);pan.copy(pt);pan.z-=1.8;frame();
  }
  function detailFocus(){
    if(shot||zoom<1.35||pose<.995)return null;
    const signature=[fitKey,zoom,pan.x,pan.y,pan.z,focusX,focusY].join('|');
    if(lastFocusKey!==signature){
      const r=canvas.getBoundingClientRect();
      focusUV=pick(r.left+r.width*focusX,r.top+r.height*focusY);
      lastFocusKey=signature;
    }
    return focusUV;
  }
  return {camera,frame,look,pick,project,rotate,reset,zoomAt,reveal,detailFocus,present,releaseShot,
    bounds:()=>page.projectedBounds(camera),
    resize(w,h){shotFit=null;camera.aspect=w/h;frame();},
    state:()=>({zoom,yaw,pitch,pivot:home.toArray(),focus:look.toArray(),position:camera.position.toArray(),mode:'overview'})};
}
