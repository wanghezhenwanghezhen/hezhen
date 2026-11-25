import * as THREE from 'three';

const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
// Survey-space crest lines. A crest runs for several grass fields, with an alluvial foot at either side.
const ranges=[
  {side:'west',ridge:[[133,230,31],[167,189,64],[206,145,46],[240,128,25]],width:72},
  {side:'west',ridge:[[142,299,27],[164,346,52],[198,389,45],[194,437,25]],width:81},
  {side:'north',ridge:[[283,137,17],[349,112,38],[408,99,50],[457,111,33],[516,113,27]],width:57},
  {side:'north',ridge:[[475,116,25],[527,110,54],[579,120,46],[619,138,21]],width:55},
  {side:'east',ridge:[[765,194,19],[798,227,38],[816,270,61],[855,299,75],[871,343,50]],width:79},
  {side:'east',ridge:[[917,348,34],[883,391,60],[862,437,74],[899,467,39],[918,520,29]],width:94},
  {side:'south',ridge:[[287,565,24],[322,585,50],[368,586,38],[398,584,20]],width:56},
  {side:'south',ridge:[[701,589,24],[754,588,58],[793,575,66],[852,563,47],[913,549,31]],width:70},
];
function gradient(tri){
  const [p,q,r]=tri,d=cross(p,q,r);
  return [( (q[2]-p[2])*(r[1]-p[1])-(r[2]-p[2])*(q[1]-p[1]))/d,
    ((q[0]-p[0])*(r[2]-p[2])-(r[0]-p[0])*(q[2]-p[2]))/d];
}
function subdivide(knots){
  const sorted=[...new Set(knots.map(n=>+n.toFixed(4)))].sort((a,b)=>a-b),all=[sorted[0]];
  for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i],n=Math.ceil((b-a)/19);
    for(let j=1;j<=n;j++)all.push(a+(b-a)*j/n);}
  return all;
}
function nearIndex(list,v){let lo=0,hi=list.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(v<list[m])hi=m;else lo=m;}return lo;}
function clipped(poly,triangle){
  for(let k=0;k<3&&poly.length;k++){
    const a=triangle[k],b=triangle[(k+1)%3],next=[];
    for(let i=0;i<poly.length;i++){
      const x=poly[i],y=poly[(i+1)%poly.length],dx=cross(a,b,x),dy=cross(a,b,y);
      if(dx>=-1e-7)next.push(x);
      if((dx<0)!==(dy<0)){const t=dx/(dx-dy);next.push([x[0]+t*(y[0]-x[0]),x[1]+t*(y[1]-x[1])]);}
    }
    poly=next;
  }
  return poly;
}
export function createPaperRelief(domain){
  const {metadata,polygon}=domain,{columns,rows}=metadata.creases;
  const [x0,y0,x1,y1]=metadata.fit.sourcePixelBounds;
  const low=domain.imageToPage(x0,y1),high=domain.imageToPage(x1,y0);
  const plain=[low[0]-3,low[1]-3,high[0]+3,high[1]+3];
  const xs=subdivide([...columns,plain[0],plain[2]]),ys=subdivide([...rows,plain[1],plain[3]]);
  const outline=THREE.ShapeUtils.triangulateShape(polygon.map(p=>new THREE.Vector2(...p)),[]).map(ids=>{
    const t=ids.map(i=>polygon[i]);return {t:cross(...t)>0?t:[t[0],t[2],t[1]],bounds:[Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[1])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[1]))]};
  });
  function height(u,v){
    const shore=domain.distanceUV(u,v),city=Math.hypot(Math.max(0,plain[0]-u,u-plain[2]),Math.max(0,plain[1]-v,v-plain[3]));
    const seam=Math.min(...columns.map(c=>Math.abs(u-c)),...rows.map(r=>Math.abs(v-r)));
    if(shore<=27||city<=0)return [0,0];
    let ridge=0;
    for(const range of ranges)for(let i=1;i<range.ridge.length;i++){
      const [x,z,h]=range.ridge[i-1],[xx,zz,hh]=range.ridge[i],dx=xx-x,dz=zz-z;
      const t=THREE.MathUtils.clamp(((u-x)*dx+(v-z)*dz)/(dx*dx+dz*dz),0,1);
      const distance=Math.hypot(u-x-t*dx,v-z-t*dz);
      const fall=Math.max(0,1-distance/range.width);
      ridge=Math.max(ridge,(h+(hh-h)*t)*fall**1.24);
    }
    const grass=4+1.5*Math.sin(.049*u+.026*v)+1.2*Math.cos(.034*u-.06*v);
    const full=(ridge+grass)*smooth(27,50,shore)*smooth(0,26,city);
    return [full*smooth(0,19,seam),full];
  }
  const lattice=ys.map((v,j)=>xs.map((u,i)=>{const [seam,full]=height(u,v);return [u,v,seam,j*xs.length+i,full];}));
  const cells=[],creases=new Map(),edges=[];
  function makeFace(a,b,c){
    const pts=[a,b,c],slope=gradient(pts),whole=gradient(pts.map(p=>[p[0],p[1],p[4]])),at=(x,y)=>a[2]+(x-a[0])*slope[0]+(y-a[1])*slope[1],atFull=(x,y)=>a[4]+(x-a[0])*whole[0]+(y-a[1])*whole[1];
    for(let k=0;k<3;k++){const p=pts[k],q=pts[(k+1)%3],r=pts[(k+2)%3];const id=Math.min(p[3],q[3])+','+Math.max(p[3],q[3]);
      const prev=creases.get(id);
      if(prev){const delta=r[2]-prev.at(r[0],r[1]);if(Math.abs(delta)>7&&Math.max(p[2],q[2])>10)edges.push({a:p,b:q,mountain:delta<0});}
      else creases.set(id,{at});
    }
    return {pts,at,atFull};
  }
  for(let j=0;j<ys.length-1;j++){cells[j]=[];for(let i=0;i<xs.length-1;i++){
    const a=lattice[j][i],b=lattice[j][i+1],c=lattice[j+1][i+1],d=lattice[j+1][i],odd=(i+j)&1;
    cells[j][i]=odd?[makeFace(a,b,d),makeFace(b,c,d)]:[makeFace(a,b,c),makeFace(a,c,d)];
  }}
  function heightAt(x,y,unity=1){
    if(x<xs[0]||x>xs.at(-1)||y<ys[0]||y>ys.at(-1))return 0;
    const i=nearIndex(xs,x),j=nearIndex(ys,y),fx=(x-xs[i])/(xs[i+1]-xs[i]),fy=(y-ys[j])/(ys[j+1]-ys[j]);
    const t=(i+j)&1?(fx+fy<=1?0:1):(fy<=fx?0:1);const face=cells[j][i][t];return Math.max(0,face.at(x,y)*(1-unity)+face.atFull(x,y)*unity);
  }
  function panel(i,j){
    const xmin=columns[i],xmax=columns[i+1],ymin=rows[j],ymax=rows[j+1],pieces=[];
    for(let b=nearIndex(ys,ymin);b<ys.length-1&&ys[b]<ymax-.001;b++)for(let a=nearIndex(xs,xmin);a<xs.length-1&&xs[a]<xmax-.001;a++){
      for(const tri of cells[b][a])for(const {t,bounds} of outline){
        if(bounds[2]<xs[a]||bounds[0]>xs[a+1]||bounds[3]<ys[b]||bounds[1]>ys[b+1])continue;
        const part=clipped(tri.pts,t);if(part.length<3)continue;
        for(let k=1;k<part.length-1;k++){const p=part[0],q=part[k],r=part[k+1];if(Math.abs(cross(p,q,r))<1e-5)continue;
          const points=cross(p,q,r)>0?[p,r,q]:[p,q,r];
          pieces.push(points.map(([x,y])=>[x,y,Math.max(0,tri.at(x,y)),Math.max(0,tri.atFull(x,y))]));
        }
      }
    }
    const crests=[];
    for(const range of ranges)for(let k=1;k<range.ridge.length;k++){
      const a=range.ridge[k-1],b=range.ridge[k],steps=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/3.8);
      let prev=null;
      for(let m=0;m<=steps;m++){const t=m/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        const current=x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax&&heightAt(x,y)>12?[x,y,heightAt(x,y,0),-1,heightAt(x,y,1)]:null;
        if(prev&&current)crests.push({a:prev,b:current,mountain:true,spine:true});
        prev=current;
      }
    }
    return {pieces,crests,edges:edges.filter(({a,b})=>{const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;return x>=xmin&&x<xmax&&y>=ymin&&y<ymax;})};
  }
  const probes={};
  for(const row of lattice)for(const p of row){let side=null;
    if(p[0]<plain[0])side='west';else if(p[0]>plain[2])side='east';else if(p[1]<plain[1])side='north';else if(p[1]>plain[3])side='south';
    if(side&&(!probes[side]||p[4]>probes[side][2]))probes[side]=[p[0],p[1],p[4]];
  }
  return {panel,heightAt,plain,probes,creaseCount:edges.length,spines:ranges.length,unifyGain:p=>smooth(.84,1,p),gain:p=>smooth(.09,.90,p)};
}
