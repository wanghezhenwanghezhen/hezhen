import * as THREE from 'three';
import { parcelCaption } from './parcel-label.js';
import { OUTLINE } from './sheet-outline.js';
import { ink } from './island-palette.js';
const meadows=[ink('098'),ink('102',1),ink('108'),ink('112'),ink('102'),ink('024'),ink('098',1)];
const warmFields=[ink('065',1),ink('134'),ink('021'),ink('068',1),ink('065'),ink('108',1)];
const coolFields=[ink('028'),ink('066',1),ink('067',1),ink('146'),ink('082'),ink('067')];
function fieldColors(x,y) {
  const ridge=Math.sin(x*.0109+y*.005)+.62*Math.cos(y*.015-x*.003);
  return ridge>.76?warmFields:ridge<-.7?coolFields:meadows;
}
function seedGen(x){return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function drawPlanImage(ctx,wfc,image){
  const toPage=wfc.sheet.imageToPage,[u,v]=toPage(0,0),[ux,vx]=toPage(1,0),[uy,vy]=toPage(0,1);
  ctx.save();ctx.transform(ux-u,vx-v,uy-u,vy-v,u,v);
  ctx.drawImage(image,0,0,wfc.plan.width,wfc.plan.height);ctx.restore();
}
export function makeSheetRoughness(wfc){
  const c=document.createElement('canvas');c.width=1080;c.height=680;
  const ctx=c.getContext('2d');ctx.fillStyle='rgb(245 245 245)';ctx.fillRect(0,0,c.width,c.height);
  drawPlanImage(ctx,wfc,wfc.print.parcelRoughness.image);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.NoColorSpace;
  texture.name='Qianyu parcel sheet roughness';texture.anisotropy=4;return texture;
}
export function makeSheetArt(wfc){
  const domain=wfc.sheet,rng=seedGen(98113), c=document.createElement('canvas'),S=3;
  c.width=1080*S;c.height=680*S;const g=c.getContext('2d');g.scale(S,S);
  g.fillStyle=ink('102');g.fillRect(0,0,1080,680);
  // Interlocking field boundaries give the landscape margins a printed survey-map scale.
  const pts=[];
  for(let y=-85;y<780;y+=55)for(let x=-100;x<1200;x+=74)pts.push([x+rng()*49,y+rng()*39]);
  function clipped(poly,nx,ny,q){
    const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];const aa=a[0]*nx+a[1]*ny-q,bb=b[0]*nx+b[1]*ny-q;
      if(aa<=0)out.push(a);if((aa>0)!==(bb>0)){const t=aa/(aa-bb);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
    return out;
  }
  function path(poly){g.beginPath();poly.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();}
  for(const a of pts){
    let poly=[[a[0]-140,a[1]-130],[a[0]+140,a[1]-130],[a[0]+140,a[1]+130],[a[0]-140,a[1]+130]];
    for(const b of pts){const dx=b[0]-a[0],dy=b[1]-a[1];if((dx||dy)&&Math.abs(dx)<200&&Math.abs(dy)<180)poly=clipped(poly,dx,dy,(b[0]**2+b[1]**2-a[0]**2-a[1]**2)/2);}
    if(!poly.length)continue;path(poly);const colors=fieldColors(...a);g.fillStyle=colors[Math.floor(rng()*colors.length)];g.fill();g.strokeStyle=ink('103',2)+'6b';g.lineWidth=1.25;g.stroke();
    g.save();g.clip();g.translate(...a);g.rotate((rng()-.5)*1.15);g.strokeStyle=ink('103',2)+'44';g.lineWidth=.56;
    for(let k=-110;k<111;k+=4+rng()*4){g.beginPath();g.moveTo(-110,k);g.bezierCurveTo(-21,k-2,21,k+4,110,k+1);g.stroke();}
    g.restore();
  }
  // Match each margin glyph to a live popup cell, so an inspected belt of woods rises from its printed location.
  for(const plant of domain.deco){
    if(plant.kind!=='paper-margin')continue;
    const [u,v]=domain.toPage(plant.x*2,plant.z*2);
    const forest=/grove|orchard|forest/.test(plant.model);
    if(forest){
      const n=plant.model==='forest'?5:3;
      for(let j=0;j<n;j++){
        const x=u+(rng()-.5)*9,y=v+(rng()-.5)*7,h=3+rng()*3;
        g.strokeStyle=ink('004',2);g.lineWidth=.58;g.beginPath();g.moveTo(x,y+1.25);g.lineTo(x-.2,y-h*.5);g.stroke();
        g.fillStyle=[ink('022'),ink('098',1),ink('024')][j%3];g.beginPath();g.moveTo(x-h*.48,y-.8);
        g.bezierCurveTo(x-h*.59,y-h*.46,x-h*.29,y-h*.87,x-h*.13,y-h*.83);
        g.bezierCurveTo(x,y-h*1.17,x+h*.23,y-h*1.11,x+h*.23,y-h*.78);
        g.bezierCurveTo(x+h*.56,y-h*.68,x+h*.58,y-h*.17,x+h*.34,y-.8);g.closePath();g.fill();g.stroke();
        g.strokeStyle=ink('108');g.lineWidth=.38;g.beginPath();g.moveTo(x-h*.29,y-h*.5);g.lineTo(x-h*.05,y-h*.77);g.stroke();
      }
    }else if(plant.model==='hills'){
      g.strokeStyle=ink('103',1);g.lineWidth=.7;for(let j=0;j<3;j++){g.beginPath();g.moveTo(u-5,v+j);g.quadraticCurveTo(u,v-5+j,u+5,v+1+j);g.stroke();}
    }else{
      g.strokeStyle=ink('022',2);g.lineWidth=.55;for(let j=0;j<5;j++){const x=u+(rng()-.5)*8,y=v+(rng()-.5)*4;g.beginPath();g.moveTo(x-1,y-1.3);g.lineTo(x,y);g.lineTo(x+1,y-2.3);g.stroke();}
    }
  }
  const toPage=domain.imageToPage;
  drawPlanImage(g,wfc,wfc.print.parcelPaving.image);
  // Fine parcel rules distinguish neighboring plots while the original material boundaries remain intact.
  const borders={landmark:ink('182',2),residential:ink('101',2),shop:ink('129',2),park:ink('022',2)};
  for(const p of wfc.plan.parcels) {
    const [u,v]=toPage(p.x,p.y+p.h),width=p.h*OUTLINE.fit.sheetPixelsPerImagePixel,height=p.w*OUTLINE.fit.sheetPixelsPerImagePixel;
    g.strokeStyle=borders[p.kind]+'A8';g.lineWidth=.42;g.strokeRect(u+.26,v+.26,Math.max(.1,width-.52),Math.max(.1,height-.52));
  }
  // The same native road image can be used in the street and on the whole folded sheet.
  const print=wfc.print.roadInk?.image;
  if(print){
    drawPlanImage(g,wfc,print);
  }else{
    g.fillStyle=ink('101');for(const r of wfc.plan.roads){const [u,v]=toPage(r.x,r.y+r.h);g.fillRect(u,v,r.h*OUTLINE.fit.sheetPixelsPerImagePixel,r.w*OUTLINE.fit.sheetPixelsPerImagePixel);}
  }
  for(const p of wfc.placements){
    const width=p.sourceBounds[3]*OUTLINE.fit.sheetPixelsPerImagePixel,depth=p.sourceBounds[2]*OUTLINE.fit.sheetPixelsPerImagePixel;
    const caption=parcelCaption(p,width,depth);if(!caption)continue;
    const [u,v]=toPage(...p.sourceCentre);
    g.save();g.translate(u+(width-caption.band)/2,v);g.rotate(-Math.PI/2);
    g.font='600 '+caption.font+'px "Microsoft YaHei",sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.strokeStyle=ink('048');g.lineWidth=.65;g.strokeText(p.label,0,0);g.fillStyle=ink('187',2);g.fillText(p.label,0,0);g.restore();
  }
  // Fine flecks and broken hatch marks are printed in paper space, independent of screen coordinates.
  for(let i=0;i<30000;i++){const x=rng()*1080,y=rng()*680;g.fillStyle=i%3?'rgba(67,63,123,.10)':'rgba(255,244,251,.26)';g.fillRect(x,y,.35+rng()*.83,.4+rng()*.45);}
  const {columns,rows}=OUTLINE.creases;
  for(let k=1;k<columns.length-1;k++){const x=columns[k];g.fillStyle=ink('101',2)+'66';g.fillRect(x-.75,40,1.15,625);g.fillStyle=ink('078')+'84';g.fillRect(x+.4,40,.95,625);}
  for(let k=1;k<rows.length-1;k++){const y=rows[k];g.fillStyle=ink('101',2)+'66';g.fillRect(74,y-.75,930,1.1);g.fillStyle=ink('078')+'84';g.fillRect(74,y+.35,930,.9);}
  // Native north points along the long right side after the rigid quarter turn.
  g.save();g.translate(151,285);g.rotate(-Math.PI/2);g.fillStyle=ink('187',2);g.font='600 15px "Microsoft YaHei",sans-serif';g.fillText('千语',0,0);
  g.font='6px "Microsoft YaHei",sans-serif';g.fillText('城市纸图',1,11);g.restore();
  g.save();g.translate(151,308);g.strokeStyle=ink('004',2);g.lineWidth=1;g.beginPath();g.moveTo(0,0);g.lineTo(21,0);g.lineTo(16,-3);g.moveTo(21,0);g.lineTo(16,3);g.stroke();
  g.translate(27,0);g.rotate(-Math.PI/2);g.fillStyle=ink('187',2);g.font='6px "Microsoft YaHei",sans-serif';g.textAlign='center';g.fillText('北',0,2);g.restore();
  path(OUTLINE.outline);g.strokeStyle=ink('103',2);g.lineWidth=2.2;g.stroke();
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;return tex;
}
