import * as THREE from 'three';
import { createFoldedSheet } from '../world/sheet-fold.js';
import { createBoardBuildings } from '../world/board-buildings.js';
import { createBoardCamera } from './board-camera.js';
import { createDiceBoard } from './dice-board.js';
import { createPost } from '../render/post.js';
import { createBoardGuide } from './board-guide.js';
import { boardShot, sampleBoardShot } from './board-presentation.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export async function createBoardSheet({wfc,assets,renderer,quality,traveller}){
  const domain=wfc.sheet,page=createFoldedSheet(wfc),canvas=renderer.domElement;
  const params=new URLSearchParams(location.search),dial=document.querySelector('#fold-dial');
  const roll=document.querySelector('#roll-dice'),status=document.querySelector('#board-status'),choices=document.querySelector('#road-choice');
  const marker=document.querySelector('#map-marker'),viewReset=document.querySelector('#reset-view');
  const go=document.querySelector('#pawn-go');
  let progress=params.has('fold')?clamp(Number(params.get('fold'))||0,0,1):0;
  let intro=!params.has('fold'),elapsed=0,shownFrames=0,prevPose=-1,span=[20,8,12],mark=null;
  let prevState='',prevChoices='',hostReady=false,lastCompleted=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reportPreview=document.documentElement.classList.contains('report-preview');
  // The authored fold uses presented simulation time, independent of asset loading.
  const introDuration = reduced ? 0.48 : 4.65;
  const demo=document.querySelector('#demo-motion');demo.checked=!reduced&&params.get('demo')!=='0';
  let idleTime=0,demoStarted=false,shotTime=0,previousShotTime=null,shotPhase='folding';
  let stillShot=reportPreview&&reduced&&params.get('demo')!=='0';
  let pawnAuto=reportPreview&&demo.checked,lastPawnTime=null;
  function takeControl(){
    demo.checked=false;stillShot=false;idleTime=0;previousShotTime=null;shotPhase='manual';navigator.releaseShot();
  }
  const buildings=createBoardBuildings({wfc,page,assets,renderer});
  const passes=[];
  let travelling=false;
  const dice=createDiceBoard({wfc,page,domain,traveller,renderer,onChange:(_state,action)=>{if(action==='roll')travelling=true;},onPass:step=>{
    const [x,z]=step.cell;buildings.update(0,{x,z},true);
    passes.push({...step,parcels:buildings.serving(x,z)});if(passes.length>90)passes.shift();
  }});
  const navigator=createBoardCamera({page,canvas,onGesture:takeControl,onTap:(ray,uv)=>{
    if(dice.hit(ray)){doRoll();return;}
    if(!uv)return;
    const site=siteAt(...uv);
    if(site)labelAt(site.label,uv);
  }});
  const post=createPost({renderer,scene:page.scene,camera:navigator.camera,quality});post.enabled=false;
  wfc.streetScenery.attachSheet(page);
  function siteAt(u,v){
    const [x,z]=domain.toWorld(u,v),[px,py]=wfc.toPixel(x/2,z/2);
    return wfc.placements.find(s=>{const [left,top,w,h]=s.sourceBounds;return px>=left&&px<left+w&&py>=top&&py<top+h;});
  }
  function labelAt(text,uv){
    mark={uv,until:performance.now()+3500};marker.textContent=text;marker.hidden=false;
  }
  function positionMarker(){
    if(!mark)return;
    if(performance.now()>mark.until){mark=null;marker.hidden=true;return;}
    const [x,y]=navigator.project(...mark.uv);
    marker.style.left=x+'px';marker.style.top=y+'px';
  }
  const guide=createBoardGuide(wfc,site=>{if(site){const uv=domain.imageToPage(...site.sourceCentre);navigator.reveal(...uv);labelAt(site.label,uv);}});
  function doRoll(){
    if(progress<.995||intro||guide.open)return false;
    pawnAuto=false;takeControl();return dice.roll();
  }
  function send(type,s){
    if(window.parent===window)return;
    window.parent.postMessage({type:'hezhen:'+type,phase:s.phase,turn:s.turn,result:s.result,stepsDone:s.stepsDone,remaining:s.remaining,cell:s.cell},location.origin);
  }
  function syncUI(){
    const s=dice.snapshot(),open=progress>=.995&&!intro;
    const token=[s.phase,s.turn,s.result,s.stepsDone,s.remaining,s.cell,open].join('|');
    if(token===prevState)return;
    prevState=token;const busy=s.phase!=='idle';
    roll.disabled=!open||busy;dial.disabled=busy;document.querySelector('#sheet-replay').disabled=busy;
    const txt=!open?'展开棋盘…':s.phase==='rolling'||s.phase==='landing'?'骰子滚动中…':s.phase==='moving'?s.result+' 点 · '+s.stepsDone+' / '+s.result+' 格':s.turn&&s.result?'掷出 '+s.result+' 点，已走 '+s.stepsDone+' 格':'准备掷骰';
    status.textContent=txt;
    const routes=s.choices||[],signature=routes.map(c=>c.id+':'+c.selected+':'+c.preferred).join('|');
    if(signature!==prevChoices){
      choices.replaceChildren();
      for(const route of routes){const op=new Option(route.label,route.id);op.selected=route.selected||(!routes.some(r=>r.selected)&&route.preferred);choices.add(op);}
      prevChoices=signature;
    }
    document.querySelector('#choice-wrap').hidden=busy||!open||routes.length<2;
    if(open&&!hostReady){hostReady=true;send('board-ready',s);}
    if(hostReady){send('board-state',s);if(s.phase==='idle'&&s.turn>lastCompleted&&s.result>0&&s.stepsDone===s.result){lastCompleted=s.turn;send('roll-landed',s);}}
  }
  document.querySelector('#map-actions').addEventListener('pointerdown',e=>{if(e.target!==demo&&e.target.tagName!=='SUMMARY'&&!e.target.closest('label[for="demo-motion"]'))takeControl();});
  document.querySelector('#board-tools').addEventListener('pointerdown',takeControl);
  demo.onchange=()=>{pawnAuto=reportPreview&&demo.checked;if(!demo.checked){takeControl();return;}idleTime=0;demoStarted=false;shotTime=0;previousShotTime=null;navigator.reset();};
  roll.onclick=go.onclick=doRoll;choices.onchange=()=>{pawnAuto=false;takeControl();dice.choose(choices.value);prevState='';syncUI();};
  document.querySelector('#rotate-left').onclick=()=>navigator.rotate(-Math.PI/8);
  document.querySelector('#rotate-right').onclick=()=>navigator.rotate(Math.PI/8);
  viewReset.onclick=()=>navigator.reset();
  document.querySelector('#find-pawn').onclick=()=>{const p=dice.point();if(p){navigator.reveal(...p.uv);labelAt('棋子',p.uv);}};
  document.querySelector('#sheet-replay').onclick=()=>{
    if(dice.snapshot().phase!=='idle')return;
    navigator.reset();progress=0;elapsed=0;shownFrames=0;intro=true;mark=null;marker.hidden=true;
    shotTime=0;previousShotTime=null;idleTime=0;demoStarted=false;shotPhase='folding';
    demo.checked=reportPreview&&!reduced;stillShot=reportPreview&&reduced;
    pawnAuto=demo.checked;lastPawnTime=null;
  };
  document.querySelector('#dice-skin').onclick=e=>{dice.changeSkin();e.currentTarget.textContent='骰子外观 · '+dice.snapshot().skinName;};
  dial.oninput=()=>{if(dice.snapshot().phase==='idle'){intro=false;progress=clamp(+dial.value/100,0,1);}};
  document.addEventListener('visibilitychange',()=>{previousShotTime=null;lastPawnTime=null;if(document.hidden)shownFrames=0;});
  canvas.addEventListener('keydown',e=>{
    if(guide.open||e.altKey||e.ctrlKey||e.metaKey)return;
    if(['Space','KeyQ','KeyE','Home','Equal','Minus'].includes(e.code))takeControl();
    if(e.code==='Space'){e.preventDefault();if(!e.repeat)doRoll();}
    if(e.code==='KeyQ'||e.code==='KeyE'){e.preventDefault();navigator.rotate((e.code==='KeyQ'?-1:1)*Math.PI/16);}
    if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();navigator.zoomAt(innerWidth/2,innerHeight/2,e.key==='-'?1/1.25:1.25);}
    if(e.key==='Home'){e.preventDefault();navigator.reset();}
  });
  window.addEventListener('message',e=>{
    if(window.parent===window||e.origin!==location.origin||e.source!==window.parent)return;
    if(e.data?.type==='hezhen:roll')doRoll();
    else if(e.data?.type==='hezhen:reset-view'){takeControl();navigator.reset();}
    else if(e.data?.type==='hezhen:query-state'&&hostReady)send('board-ready',dice.snapshot());
  });
  await dice.ready;
  function update(dt){
    if(intro&&!document.hidden&&shownFrames>=2){
      elapsed+=dt;
      const t=clamp((elapsed-.22)/introDuration,0,1);progress=t*t*(3-2*t);
      if(t>=1)intro=false;
    }
    const moved=prevPose!==progress;
    if(moved){span=page.pose(progress);prevPose=progress;dial.value=Math.round(progress*100);}
    const canDemo=demo.checked&&!document.hidden&&!guide.open;
    const unfolded=!intro&&progress>=.995;
    let playingDt=dt;
    if(reportPreview && unfolded && (canDemo||stillShot)){
      const now=performance.now();
      const wallDt=previousShotTime===null?0:(now-previousShotTime)/1000;
      previousShotTime=now;
      shotTime=stillShot?boardShot.seconds:shotTime+wallDt;
      const sample=sampleBoardShot(shotTime);
      if(!stillShot||shotPhase!=='still')navigator.present(sample,progress,span);
      shotPhase=stillShot?'still':sample.phase;
    }else{
      previousShotTime=null;
      if(reportPreview&&canDemo&&moved){
        navigator.present({yaw:boardShot.openingYaw*progress,pitch:0,blend:0},progress,span);
      }else if(moved)navigator.frame(progress,span);
    }
    // The report visitor can orbit the map while the pawn continues its own
    // turns. An explicit roll or road choice hands the pawn to the visitor.
    if(pawnAuto && unfolded && !document.hidden && !guide.open){
      const now=performance.now();
      playingDt=lastPawnTime===null?0:(now-lastPawnTime)/1000;
      lastPawnTime=now;
      idleTime=dice.snapshot().phase==='idle'?idleTime+playingDt:0;
      if(idleTime>=(demoStarted?2:1.15) && dice.roll()){
        demoStarted=true;idleTime=0;playingDt=0;
      }
    }else lastPawnTime=null;
    dice.update(playingDt,{progress});const p=dice.point();
    const onBoard=progress>.97&&!intro;
    const focus=onBoard?navigator.detailFocus():null,view=navigator.state();
    if(p){
      const road=travelling?{x:p.cell[0],z:p.cell[1]}:null;
      buildings.update(dt,road,onBoard,focus);
      if(focus)wfc.paperAssets?.ground(...focus);
      wfc.streetScenery.updateSheet(dt,road?p.world[0]:Infinity,road?p.world[1]:Infinity,
        focus?domain.toWorld(...focus):null,view.zoom,progress);
    }
    syncUI();positionMarker();
    go.hidden=roll.disabled||guide.open||!!mark;
    if(!go.hidden){const [x,y]=dice.screenAnchor(navigator.camera);go.style.left=x+'px';go.style.top=y+'px';}
    dice.detail(view.zoom);viewReset.disabled=view.zoom===1&&Math.abs(view.yaw)<.001&&Math.abs(view.pitch)<.001;
  }
  function render(dt){post.setFocus(navigator.look);post.render(dt);if(!document.hidden&&document.body.classList.contains('ready'))shownFrames=Math.min(2,shownFrames+1);}
  function snapshot(){return {mode:'overview',progress,span,panels:page.faceCount,terrain:page.terrainInfo(),navigation:navigator.state(),
    board:dice.snapshot(),buildings:buildings.snapshot(),passes:[...passes],streetScenery:wfc.streetScenery.diagnostics(),
    detail:wfc.paperAssets?.detailState(),demo:demo.checked,opening:{firstFrames:shownFrames,time:elapsed,auto:intro},
    presentation:{phase:shotPhase,seconds:shotTime,duration:boardShot.seconds,rate:boardShot.radiansPerSecond,pawnAuto}};}
  window.paperSheet={snapshot,project:navigator.project,bounds:navigator.bounds,hit:navigator.pick,mapPoint:domain.toPage,locations:buildings.locations,
    roadParcels:buildings.serving,roll:doRoll,choose:id=>dice.choose(id),changeSkin:()=>dice.changeSkin(),boardPoint:()=>dice.point()};
  return {update,render,resize(w,h){navigator.resize(w,h);post.setSize(w,h);}};
}
