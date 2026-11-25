import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE_SIZE } from '../core/config.js';

const assetUrl = (name) => new URL('road-v5/' + name, document.baseURI).href;
const key = (x, z) => x + ',' + z;
const corners = [[1, -1], [-1, -1], [-1, 1], [1, 1]];
const chunkSize = 5;

async function jsonAsset(name) {
  const response = await fetch(assetUrl(name));
  if (!response.ok) throw Error('道路资料读取失败 ' + name + ' ' + response.status);
  return response.json();
}

// Preserve UVs and real normals at every cut. This is the R28 half-plane subtraction
// used where a rounded corner occupies its neighbouring shoulder's square.
function splitPolygon(polygon, axis, boundary) {
  const positive = [], negative = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a[axis] - boundary, db = b[axis] - boundary;
    (da >= -1e-8 ? positive : negative).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db), cut = a.map((v, k) => v + (b[k] - v) * t);
      positive.push(cut); negative.push(cut);
    }
  }
  return [positive, negative];
}

function subtractRect(polygon, [x0, z0, x1, z1]) {
  let inside = polygon;
  const keep = [];
  for (const [axis, edge, lower] of [[0, x0, true], [0, x1, false], [2, z0, true], [2, z1, false]]) {
    if (inside.length < 3) break;
    const [positive, negative] = splitPolygon(inside, axis, edge);
    const outside = lower ? negative : positive;
    if (outside.length >= 3) keep.push(outside);
    inside = lower ? positive : negative;
  }
  return keep;
}

function clippedShoulder(geom, rects) {
  const {position, normal, uv} = geom.attributes, points = [], normals = [], uvs = [];
  for (let i = 0; i < position.count; i += 3) {
    let polygons = [Array.from({length: 3}, (_, j) => {
      const k = i + j;
      return [position.getX(k), position.getY(k), position.getZ(k), normal.getX(k), normal.getY(k), normal.getZ(k), uv.getX(k), uv.getY(k)];
    })];
    for (const r of rects) polygons = polygons.flatMap(poly => subtractRect(poly, r));
    for (const p of polygons) {
      for (let j = 1; j < p.length - 1; j++) {
        for (const v of [p[0], p[j], p[j + 1]]) {
          points.push(v[0], v[1], v[2]); normals.push(v[3], v[4], v[5]); uvs.push(v[6], v[7]);
        }
      }
    }
  }
  const result = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position', points, 3], ['normal', normals, 3], ['uv', uvs, 2]]) {
    result.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  return result;
}

function mergeParts(parts) {
  const real = parts.filter(g => g.attributes.position.count);
  if (!real.length) return null;
  const out = mergeGeometries(real);
  if (!out) throw Error('V5道路几何属性不兼容');
  return out;
}

function sourceTemplateAssets(scene) {
  const templates = new Map(), materials = new Map();
  scene.updateMatrixWorld(true);
  scene.traverse(tile => {
    const m = /^RoadTile_(\d\d)_V5$/.exec(tile.name);
    if (!m) return;
    const parts = [];
    tile.traverse(o => {
      if (!o.isMesh) return;
      materials.set(o.material.name, o.material);
      // The original native map assigns reciprocal profiles per edge. Remove the GLB's
      // tile-preview swatches and construct the two inward halves from those real profiles.
      if (o.material.name.startsWith('V5_Paint_')) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const attr of Object.keys(g.attributes)) if (!['position','normal','uv'].includes(attr)) g.deleteAttribute(attr);
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingBox();
      const corner = /Corner_(\d)_/.exec(o.name);
      parts.push({g, material:o.material.name, isCurb:o.name.includes('Curb'), corner:corner ? +corner[1] : -1});
    });
    templates.set(+m[1], parts);
  });
  if (templates.size !== 16) throw Error('V5路块模板数量错误');
  return {templates, materials};
}

function paintGeometry(polygons) {
  const vertices = [], normals = [], uv = [];
  for (const poly of polygons) {
    const ring = poly.map(([x,z]) => new THREE.Vector2(x,z));
    for (const face of THREE.ShapeUtils.triangulateShape(ring, [])) {
      // ShapeUtils emits CCW in 2D, which faces down on the Three XZ plane.
      for (const i of [face[0], face[2], face[1]]) {
        const p = ring[i];
        vertices.push(p.x, .00015, p.y); normals.push(0,1,0); uv.push(p.x+.5,.5-p.y);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  for (const [name,values,size] of [['position',vertices,3],['normal',normals,3],['uv',uv,2]]) {
    g.setAttribute(name, new THREE.Float32BufferAttribute(values,size));
  }
  return g;
}

async function applySurfaceMaterials(materials, manifest) {
  const loader = new THREE.TextureLoader();
  await Promise.all(Object.entries(manifest.materials).map(async ([name, config]) => {
    const load = async (ref) => {
      const t = await loader.loadAsync(assetUrl(ref.url.split('/').pop()));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.flipY = false;
      t.anisotropy = 8;
      return t;
    };
    const [map, bumpMap] = await Promise.all([load(config.albedo),load(config.height)]);
    map.colorSpace = THREE.SRGBColorSpace;
    materials.set(name, new THREE.MeshStandardMaterial({name,map,bumpMap,bumpScale:config.bumpScale,roughness:config.roughness,metalness:0}));
  }));
  for (const name of ['V5_Paint_White','V5_Paint_Yellow']) {
    const paint = materials.get(name);
    // The frozen source puts paint at .00015 U. Polygon offset preserves that depth on mobile.
    paint.polygonOffset = true; paint.polygonOffsetFactor = -1; paint.polygonOffsetUnits = -1;
  }
}

function buildChunks(wfc, source, network) {
  const cells = new Set(wfc.roads.map(r => key(r.x,r.z)));
  if (cells.size !== network.tiles.length || network.tiles.some(t => !cells.has(key(t.x,t.z)))) throw Error('V5道路与当前规划不一致');
  const has = (x,z) => cells.has(key(x,z));
  const cornerBits = (x,z) => corners.map(([dx,dz]) => has(x+dx,z) && has(x,z+dz) && !has(x+dx,z+dz));
  const cuts = [];
  for (const t of network.tiles) {
    const enabled = cornerBits(t.x,t.z);
    corners.forEach(([dx,dz],i) => {
      if (!enabled[i]) return;
      const x = t.x + dx*.5, z = t.z + dz*.5;
      cuts.push([Math.min(x,x+dx*.12), Math.min(z,z+dz*.12), Math.max(x,x+dx*.12), Math.max(z,z+dz*.12)]);
    });
  }
  const reusable = new Map(), stamps = new Map(), chunkParts = new Map(), result = [];
  const stats = {cells:cells.size,maskCounts:{},enabledCorners:cuts.length,sharedEdges:0,profileEnds:{},eventMarks:0,triangles:0};
  for (const tile of network.tiles) {
    const {x,z,mask} = tile;
    const liveMask = (has(x,z-1)?1:0) | (has(x+1,z)?2:0) | (has(x,z+1)?4:0) | (has(x-1,z)?8:0);
    if (mask !== liveMask) throw Error('V5路口mask不匹配 '+key(x,z));
    stats.maskCounts[mask]=(stats.maskCounts[mask]||0)+1;
    const enabled = cornerBits(x,z);
    const rects = cuts.filter(r => r[0]<x+.631 && r[2]>x-.631 && r[1]<z+.631 && r[3]>z-.631)
      .map(r => r.map((v,i) => +(v-(i%2?z:x)).toFixed(4)));
    const variant = JSON.stringify([mask,enabled,rects]);
    if (!reusable.has(variant)) {
      const batch = new Map(), temporary=[];
      for (const part of source.templates.get(mask)) {
        if (part.corner>=0 && !enabled[part.corner]) continue;
        let g = part.g;
        if (part.isCurb) {
          const b=g.boundingBox, near=rects.filter(r=>b.min.x<r[2]-1e-7 && b.max.x>r[0]+1e-7 && b.min.z<r[3]-1e-7 && b.max.z>r[1]+1e-7);
          if (near.length) {g=clippedShoulder(g,near);temporary.push(g);}
        }
        if (!batch.has(part.material)) batch.set(part.material,[]);
        batch.get(part.material).push(g);
      }
      reusable.set(variant,[...batch].map(([name,parts])=>[name,mergeParts(parts)]).filter(r=>r[1]));
      temporary.forEach(g=>g.dispose());
    }
    const cx=Math.floor(x/chunkSize), cz=Math.floor(z/chunkSize), id=key(cx,cz);
    if (!chunkParts.has(id)) chunkParts.set(id,{cx,cz,materials:new Map()});
    const chunk=chunkParts.get(id);
    function append(name,g) {
      if (!chunk.materials.has(name)) chunk.materials.set(name,[]);
      chunk.materials.get(name).push(g.clone().translate(x,0,z));
    }
    for (const [name,g] of reusable.get(variant)) append(name,g);
    for (const p of tile.ports) {
      if (!stamps.has(p.shape)) stamps.set(p.shape,paintGeometry(network.paintShapes[p.shape].polys));
      append(p.profile===4?'V5_Paint_Yellow':'V5_Paint_White',stamps.get(p.shape));
      stats.profileEnds[p.profile]=(stats.profileEnds[p.profile]||0)+1;
      stats.sharedEdges+=.5;
    }
  }
  for (const chunk of chunkParts.values()) {
    const group = new THREE.Group();
    group.name='V5-road-chunk-'+key(chunk.cx,chunk.cz);
    for (const [name,parts] of chunk.materials) {
      const g=mergeParts(parts); parts.forEach(p=>p.dispose());
      if (!g) continue;
      const mesh = new THREE.Mesh(g,source.materials.get(name));
      mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;
      group.add(mesh);stats.triangles+=g.attributes.position.count/3;
    }
    result.push({group,cx:chunk.cx,cz:chunk.cz});
  }
  for (const rows of reusable.values()) rows.forEach(([,g])=>g.dispose());
  for (const g of stamps.values()) g.dispose();
  for (const parts of source.templates.values()) parts.forEach(p=>p.g.dispose());
  stats.chunks=result.length;
  return {chunks:result,stats};
}

function bakePaper(renderer, roadGroup, plan) {
  const scene=new THREE.Scene();
  scene.add(roadGroup);
  scene.add(new THREE.HemisphereLight(0xffffff,0xe9e5d8,1.9));
  const sun=new THREE.DirectionalLight(0xfff7e8,1.35);
  sun.position.set(-3,6,-2);scene.add(sun);
  const {width,height,grid}=plan, cell=grid.pitch, ox=grid.originX+cell/2, oy=grid.originY+cell/2;
  const camera=new THREE.OrthographicCamera(-ox/cell,(width-ox)/cell,oy/cell,-(height-oy)/cell,.01,150);
  camera.position.set(0,25,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
  const zoom=Math.min(2,renderer.capabilities.maxTextureSize/Math.max(width,height));
  const w=Math.round(width*zoom), h=Math.round(height*zoom);
  const target=new THREE.WebGLRenderTarget(w,h,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,colorSpace:THREE.SRGBColorSpace,depthBuffer:true});
  const oldTarget=renderer.getRenderTarget(), color=renderer.getClearColor(new THREE.Color()), alpha=renderer.getClearAlpha();
  const oldTone=renderer.toneMapping;
  const pixels=new Uint8Array(w*h*4);
  try {
    renderer.toneMapping=THREE.NoToneMapping;renderer.setClearColor(0,0);renderer.setRenderTarget(target);
    renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,w,h,pixels);
  } finally {
    renderer.setRenderTarget(oldTarget);renderer.setClearColor(color,alpha);renderer.toneMapping=oldTone;target.dispose();scene.remove(roadGroup);
  }
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d'), img=ctx.createImageData(w,h);
  for(let y=0;y<h;y++)img.data.set(pixels.subarray((h-y-1)*w*4,(h-y)*w*4),y*w*4);
  ctx.putImageData(img,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.name='V5-R28-road-print';texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

export async function prepareCityRoads(wfc,renderer,scene) {
  const [gltf,manifest,network]=await Promise.all([new GLTFLoader().loadAsync(assetUrl('tiles.glb')),jsonAsset('manifest.json'),jsonAsset('connections.json')]);
  const source=sourceTemplateAssets(gltf.scene);
  await applySurfaceMaterials(source.materials,manifest);
  const {chunks,stats}=buildChunks(wfc,source,network);
  if(wfc.roadCardPolicy)stats.roadCards=wfc.roadCardPolicy;
  const root=new THREE.Group();root.name='Qianyu-R28-road-V5';chunks.forEach(c=>root.add(c.group));
  wfc.print.roadInk=bakePaper(renderer,root,wfc.plan);
  root.scale.setScalar(TILE_SIZE);
  // Contact plane lies just above the physical book sheet. Preserve all native relative heights.
  root.position.y=.003;
  scene.add(root);
  stats.glbSha256=manifest.glbSha256;stats.sourceBlender=manifest.sourceSha256;
  stats.textures=[...source.materials.values()].filter(m=>m.map).map(m=>({material:m.name,albedo:manifest.materials[m.name].albedo.sha256,height:manifest.materials[m.name].height.sha256,bumpScale:m.bumpScale,roughness:m.roughness,uv:'Cell_WorldXY_1x1',size:[m.map.image.width,m.map.image.height]}));
  stats.printSize=[wfc.print.roadInk.image.width,wfc.print.roadInk.image.height];
  wfc.nativeRoads={root,stats,update(wx,wz){
    const x=wx/TILE_SIZE,z=wz/TILE_SIZE;
    for(const c of chunks){
      const x0=c.cx*chunkSize-.64,z0=c.cz*chunkSize-.64;
      const dx=Math.max(x0-x,0,x-x0-chunkSize-.28),dz=Math.max(z0-z,0,z-z0-chunkSize-.28);
      c.group.visible=dx*dx+dz*dz<=25;
    }
  }};
  root.userData.roadSourceValidation=stats;
}
