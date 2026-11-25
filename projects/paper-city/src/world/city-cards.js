import { printedLandmarks,grainRGBA } from './city-print-plates.js';

const byLabel = new Map(printedLandmarks.map(kit => [kit.name, kit]));
const aliases = new Map([['国家游泳中心','水立方'],['国家体育场','鸟巢'],['中央电视塔','中央广播电视塔'],['祈年殿','天坛公园'],['中信大厦','中国尊']]);
export function cityCardId(label) {
  const name = String(label || '').replace(/\s/g, '');
  return byLabel.get(aliases.get(name) || name)?.model || null;
}
function trace(ctx, points, close) {
  if (!points.length) return;
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x,y] of points.slice(1)) ctx.lineTo(x,y);
  if (close) ctx.closePath();
}
function paintSheet(ctx,plate,grain) {
  ctx.fillStyle = plate.base;
  ctx.fillRect(-2,-2,104,104);
  ctx.save();
  ctx.beginPath();
  trace(ctx,plate.cut,true);
  for (const clip of plate.holes) trace(ctx,clip,true);
  ctx.clip('evenodd');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [kind, points, fill, stroke, thickness] of plate.ink) {
    ctx.beginPath();
    trace(ctx,points,kind==='p');
    if (fill) { ctx.fillStyle=fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=thickness; ctx.stroke(); }
  }
  ctx.scale(30/64,30/64);
  ctx.fillStyle=grain;ctx.fillRect(0,0,214,214);
  ctx.restore();
}

/** All sets of UVs address one common color map. Generating it synchronously
 * ensures the book can render its folded atlas on the very first frame. */
export function createPrintMaterial(T,kits=printedLandmarks) {
  const count=kits.reduce((n,k)=>n+k.panels.length,0);
  const columns=Math.ceil(Math.sqrt(count)), rows=Math.ceil(count/columns);
  const side=128, pad=3, inner=side-2*pad;
  const canvas=document.createElement('canvas');
  canvas.width=columns*side;canvas.height=rows*side;
  const ctx=canvas.getContext('2d',{alpha:false});
  const grainCanvas=document.createElement('canvas');grainCanvas.width=grainCanvas.height=64;
  const grainCtx=grainCanvas.getContext('2d'),raw=Uint8ClampedArray.from(atob(grainRGBA),c=>c.charCodeAt(0));
  grainCtx.putImageData(new ImageData(raw,64,64),0,0);
  const grain=ctx.createPattern(grainCanvas,'repeat');
  ctx.fillStyle='#ead7b0';ctx.fillRect(0,0,canvas.width,canvas.height);
  const regions=new Map();
  let index=0;
  for(const kit of kits) for(const p of kit.panels) {
    const x=(index%columns)*side+pad,y=Math.floor(index/columns)*side+pad;
    ctx.save();ctx.translate(x,y);ctx.scale(inner/100,inner/100);
    paintSheet(ctx,p,grain);ctx.restore();
    regions.set(p,{x,y,inner,width:canvas.width,height:canvas.height});
    index++;
  }
  const texture=new T.CanvasTexture(canvas);
  texture.name='city-landmark-ink';texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=4;
  const material=new T.MeshStandardMaterial({name:'Folded uncoated printed stock',map:texture,roughness:1,metalness:0,vertexColors:true,side:T.DoubleSide});
  return {material,regions,count};
}
function cutGeometry(T,p,uvRect) {
  const ring=path=>path.map(([x,y])=>new T.Vector2((x/100-.5)*p.width,(1-y/100)*p.height));
  const outside=ring(p.cut), voids=p.holes.map(ring);
  const vertices=outside.concat(...voids);
  const tris=T.ShapeUtils.triangulateShape(outside,voids);
  if (!tris.length) throw new Error('Empty printed card '+p.key);
  const pos=[],col=[],uv=[];
  const depth=p.paperThickness/2;
  function vertex(v,z,edge=false) {
    pos.push(v.x,v.y,z);
    const u=v.x/p.width+.5,t=1-v.y/p.height;
    if(edge) {
      uv.push(.5/uvRect.width,1-.5/uvRect.height);col.push(.88,.81,.66);
    } else {
      uv.push((uvRect.x+uvRect.inner*u)/uvRect.width,1-(uvRect.y+uvRect.inner*t)/uvRect.height);
      col.push(1,1,1);
    }
  }
  for(const [a,b,c] of tris) {
    const v=vertices[a],w=vertices[b],u=vertices[c];
    const signed=(w.x-v.x)*(u.y-v.y)-(w.y-v.y)*(u.x-v.x);
    const tri=signed>0?[v,w,u]:[v,u,w];
    for(const j of tri) vertex(j,depth);
    for(const j of [...tri].reverse()) vertex(j,-depth);
  }
  for(const loop of [outside,...voids]) for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length];
    for(const [v,z] of [[a,depth],[a,-depth],[b,-depth],[a,depth],[b,-depth],[b,depth]]) vertex(v,z,true);
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new T.Float32BufferAttribute(col,3));
  geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
  return geo;
}
export function assemblePrintKit(T,kit,print,base) {
  const tile=new T.Group();tile.name=kit.model;
  tile.userData={model:kit.model,parcel:kit.parcel,landmarkName:kit.name};
  if(base)tile.add(base.clone());
  const flaps=new Map();
  for(const p of kit.panels) {
    const flap=new T.Group();flap.name='panel_'+p.key;
    flap.position.fromArray(p.position);
    flap.rotation.set(p.pitch,p.yaw,0,'YXZ');
    flap.userData={hinge:true,foldAngle:p.parent?Math.PI/2:-Math.PI/2,delay:p.parent?.70:Math.min(.59,p.layer*.11),layer:p.layer,size:Math.max(.16,Math.min(.74,p.height*.56)),sway:0,plateId:kit.parcel+'/'+p.key,role:p.role,cutRings:1+p.holes.length};
    const mesh=new T.Mesh(cutGeometry(T,p,print.regions.get(p)),print.material);
    mesh.name='ink_'+p.key;mesh.castShadow=true;mesh.receiveShadow=true;
    flap.add(mesh);
    (p.parent?flaps.get(p.parent):tile).add(flap);
    flaps.set(p.key,flap);
  }
  return tile;
}
export function registerCityCards(T,assets,models,modelIds) {
  const previous=assets.getTilePrototype.bind(assets), base=previous('meadow').getObjectByName('base');
  if(!base)throw new Error('Papertrails meadow base unavailable');
  const print=createPrintMaterial(T),tiles=new Map();
  for(const kit of printedLandmarks) {
    if(models[kit.model])throw new Error('Duplicate landmark '+kit.model);
    tiles.set(kit.model,assemblePrintKit(T,kit,print,base));
    models[kit.model]={sockets:{n:'grass',e:'grass',s:'grass',w:'grass'},tags:['landmark','blocker'],biomes:{heartland:1}};
    if(!modelIds.includes(kit.model))modelIds.push(kit.model);
    if(!assets.modelIds.includes(kit.model))assets.modelIds.push(kit.model);
  }
  assets.getTilePrototype=id=>tiles.get(id)||previous(id);
  return [...tiles.keys()];
}
