export function createBoardGuide(wfc,onLocate){
  const dialog=document.querySelector('#city-guide'),select=document.querySelector('#places');
  const canvas=document.querySelector('#city-map'),ctx=canvas.getContext('2d'),plan=wfc.plan;
  canvas.width=plan.width;canvas.height=plan.height;
  for(const site of [...wfc.placements].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'))){
    select.add(new Option(site.label,site.id));
  }
  function selected(){return wfc.placements.find(s=>s.id===select.value);}
  let guideImage;
  function draw(){
    ctx.setTransform(-1,0,0,-1,canvas.width,canvas.height);
    ctx.fillStyle='#fff7e9';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(guideImage)ctx.drawImage(guideImage,0,0,canvas.width,canvas.height);
    else if(wfc.print){ctx.drawImage(wfc.print.parcelPaving.image,0,0,canvas.width,canvas.height);ctx.drawImage(wfc.print.roadInk.image,0,0,canvas.width,canvas.height);}
    else for(const p of plan.parcels){ctx.fillStyle='#e5d5dd';ctx.fillRect(p.x,p.y,p.w,p.h);}
    const site=selected();if(site){ctx.strokeStyle='#58173f';ctx.lineWidth=5;ctx.strokeRect(...site.sourceBounds);}
  }
  select.addEventListener('change',draw);
  document.querySelector('#guide-button').onclick=()=>{
    dialog.showModal();draw();
    if(!guideImage&&wfc.paperAssets)wfc.paperAssets.guide().then(img=>{guideImage=img;if(dialog.open)draw();}).catch(()=>{});
  };
  document.querySelector('#guide-close').onclick=()=>dialog.close();
  document.querySelector('#guide-locate').onclick=()=>{dialog.close();onLocate(selected());};
  canvas.onclick=e=>{
    const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/canvas.width,r.height/canvas.height);
    const x=canvas.width-(e.clientX-r.left-(r.width-scale*canvas.width)/2)/scale;
    const y=canvas.height-(e.clientY-r.top-(r.height-scale*canvas.height)/2)/scale;
    const p=plan.parcels.find(p=>x>=p.x&&x<p.x+p.w&&y>=p.y&&y<p.y+p.h);
    if(p){select.value=p.id;draw();}
  };
  return {get open(){return dialog.open;}};
}
