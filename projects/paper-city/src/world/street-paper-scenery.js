import {createPrintedStreetView} from './street-paper-view.js';
import * as THREE from 'three';
import { tintIslandStreetAtlas } from './island-print.js';
import { SCENERY_PLATES, SOURCE_SEGMENTS, SOURCE_STREET_ROWS, SOURCE_PRESET, STREET_PRINT_ATLAS } from './street-scenery-source.js';

const cellKey = (x,z) => x+','+z;
const clamp = (x,lo,hi) => Math.min(hi,Math.max(lo,x));
const arc = Math.PI / 2;
const special = new Set(['fitness','dog_playground','inflatable_rabbits','stage','cinema']);
const length2 = (x,z) => Math.hypot(x,z);

function streetRuns(roads) {
  const occupied=new Set(roads.map(r=>cellKey(r.x,r.z))), runs=[];
  for (const axis of [0,1]) {
    const dx=axis===1?1:0, dz=1-dx;
    for (const {x,z} of roads) {
      if (occupied.has(cellKey(x-dx,z-dz))) continue;
      let n=1;
      while(occupied.has(cellKey(x+dx*n,z+dz*n))) n++;
      if(n<3) continue;
      runs.push({axis,fixed:axis===0?x:z,start:axis===0?z:x,n});
    }
  }
  return runs;
}
function normPosition(s,maxX,maxZ,source) {
  const mid=source?(s.start+s.end)/2:s.start+(s.n-1)/2;
  return s.axis===0?[s.fixed/maxX,mid/maxZ]:[mid/maxX,s.fixed/maxZ];
}
function lineDistance(x,z,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
  return length2(x-a[0]-t*dx,z-a[1]-t*dz);
}
export function planStreetPaperScenery(wfc) {
  const runs=streetRuns(wfc.roads);
  const maxX=Math.max(...wfc.roads.map(r=>r.x),1),maxZ=Math.max(...wfc.roads.map(r=>r.z),1);
  const sourceX=Math.max(...SOURCE_SEGMENTS.map(s=>s.axis===0?s.fixed:s.end),1),sourceZ=Math.max(...SOURCE_SEGMENTS.map(s=>s.axis===1?s.fixed:s.end),1);
  const byLine=new Map();
  for(const s of SOURCE_SEGMENTS) {
    const [x,z]=normPosition(s,sourceX,sourceZ,true);
    const score=r=>{
      const [xx,zz]=normPosition(r,maxX,maxZ,false);
      return length2(x-xx,z-zz)+.095*Math.abs(Math.log(Math.max(1,s.length)/r.n));
    };
    byLine.set(s.id,runs.filter(r=>r.axis===s.axis).sort((a,b)=>score(a)-score(b)).slice(0,5));
  }
  const roadSet=new Set(wfc.roads.map(r=>cellKey(r.x,r.z)));
  const origin=wfc.toPixel(0,0),pitch=wfc.plan.grid.pitch,props=[];
  const doors=wfc.placements.map(p=>{
    const centre=(p.displayAnchorPixel||p.anchorPixel).map((a,i)=>2*(a-origin[i])/pitch);
    return {id:p.id,kind:p.kind,centre,entry:p.street.map(v=>2*v),focus:[2*p.anchor[0],2*p.anchor[1]+.96]};
  });
  const lamps=[];
  for(const r of wfc.roads) {
    const cell=wfc.get(r.x,r.z);
    if(cell.model!=='qy_road_lamp') continue;
    const a=-cell.rot*arc;
    lamps.push([2*r.x+1.43*Math.cos(a),2*r.z-1.43*Math.sin(a)]);
  }
  function roadClear(x,z) {
    let d=Infinity;
    for(let i=Math.floor(x/2)-2;i<=Math.ceil(x/2)+2;i++) for(let j=Math.floor(z/2)-2;j<=Math.ceil(z/2)+2;j++) {
      if(!roadSet.has(cellKey(i,j))) continue;
      const dx=Math.abs(2*i-x)-1,dz=Math.abs(2*j-z)-1;
      d=Math.min(d,length2(Math.max(0,dx),Math.max(0,dz))+Math.min(0,Math.max(dx,dz)));
    }
    return d;
  }
  function fit(x,z,radius,model) {
    const clear=roadClear(x,z);
    if(clear<radius+.16 || wfc.clearance(x,z)<radius+.2) return null;
    if(lamps.some(([a,b])=>length2(x-a,z-b)<radius+(model==='streetlight'?1.4:.55))) return null;
    let entryClear=Infinity,nearest=null,best=Infinity;
    for(const d of doors) {
      const distance=length2(x-d.centre[0],z-d.centre[1]);
      if(distance<best){nearest=d;best=distance;}
      if(distance<radius+.94 || length2(x-d.focus[0],z-d.focus[1])<radius+.24) return null;
      if(d.kind==='landmark') entryClear=Math.min(entryClear,lineDistance(x,z,d.centre,d.entry));
    }
    if(entryClear<radius+.35) return null;
    if(props.some(p=>length2(p.x-x,p.z-z)<radius+p.radius+.16)) return null;
    return {clear:clear-radius,door:entryClear-radius,nearest:nearest.id};
  }
  const counts={};
  for(const r of SOURCE_STREET_ROWS) counts[r[1]]=(counts[r[1]]||0)+1;
  const sorted=[...SOURCE_STREET_ROWS].sort((a,b)=>counts[a[1]]-counts[b[1]]||a[0].localeCompare(b[0]));
  for(const [id,model,seg,side,t,size,yaw] of sorted) {
    const [w,h,d]=size,scale=Math.min(.86,1.72/Math.max(w,h,d));
    const width=w*scale,height=h*scale,depth=d*scale;
    // Max horizontal reach includes the paper hinge sweep as well as the upright print.
    const radius=Math.max(width,depth)*.505+height*.225+.025;
    let placed=false;
    const options=byLine.get(seg)||[];
    for(const run of options) {
      for(const extra of (special.has(model)?[.35,.9,1.5]:[0,.34,.73])) {
        for(const move of [0,.45,-.45,.9,-.9]) {
          const long=2*(run.start+t*(run.n-1))+move;
          const across=2*run.fixed+side*(1.24+radius+extra);
          const x=run.axis===0?across:long, z=run.axis===0?long:across;
          const safe=fit(x,z,radius,model);
          if(!safe)continue;
          props.push({id,model,x,z,yaw:-yaw,width,height,depth,radius,segment:seg,side,sourceFraction:t,parcel:safe.nearest,roadClearance:safe.clear,doorClearance:safe.door});
          placed=true;break;
        }
        if(placed)break;
      }
      if(placed)break;
    }
  }
  return props;
}

export function createStreetPaperScenery(wfc) {
  const placements=planStreetPaperScenery(wfc);
  const texture=new THREE.TextureLoader().load(STREET_PRINT_ATLAS, tex=>tintIslandStreetAtlas(tex,Object.keys(SCENERY_PLATES)));
  texture.colorSpace=THREE.SRGBColorSpace;texture.name='千语原模・双向纸面印刷';texture.anisotropy=4;
  return createPrintedStreetView(wfc,{placements,plates:SCENERY_PLATES,preset:SOURCE_PRESET,records:SOURCE_STREET_ROWS.length},texture);
}
