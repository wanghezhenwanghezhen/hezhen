import * as THREE from 'three';
import { state } from '../core/state.js';

// A cloud opening is shared by all slices and the receiving surface. Its UV is the
// intersection with the base plane traced parallel to the current directional light.
const cloudLookup = /* glsl */ `
uniform sampler2D tCloudMask;
uniform vec3 uSunSlope;
uniform vec4 uCloudField; // frequency, time, daylight/precipitation envelope, height
float opening(vec3 p) {
  vec2 base = p.xz - p.y * uSunSlope.xz;
  vec2 uv = base * uCloudField.x + vec2(0.217, 0.435) + uCloudField.y * vec2(0.0012, -0.0007);
  return smoothstep(0.41, 0.63, texture2D(tCloudMask, uv).r);
}`;

export const cloudComposite = cloudLookup + /* glsl */ `
uniform sampler2D tCloudSlices;
vec3 composeCloudLight(vec3 col, vec2 uv, float z, float rawDepth) {
  if (uCloudField.z <= 0.0 || rawDepth >= 0.99999) return col;
  vec3 local = vec3((2.0 * uv - 1.0) * vec2(uProj.z * uProj.w, uProj.z) * z, -z);
  vec3 surface = (uCamWorld * vec4(local, 1.0)).xyz;
  // Preserve the independent tabletop and the background beyond the die-cut.
  float paper = smoothstep(-0.07, -0.01, surface.y);
  float gap = opening(surface);
  vec3 shade = mix(vec3(0.72, 0.78, 0.87), vec3(1.05, 1.025, 1.0), gap);
  vec3 shafts = texture2D(tCloudSlices, uv).rgb;
  return mix(col, col * shade + shafts, paper * uCloudField.z);
}`;

function cloudMask() {
  const size = 128;
  const pixels = new Uint8Array(size * size);
  let seed = 5313;
  const grids = [4, 8, 16, 32].map(n => {
    const values = Float32Array.from({length:n*n}, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    return (x, y) => {
      const ix = Math.floor(x*n), iy = Math.floor(y*n);
      const smooth = f => f*f*(3-2*f);
      const fx = smooth(x*n-ix), fy = smooth(y*n-iy);
      const get = (i,j) => values[((j+n)%n)*n+(i+n)%n];
      const a = THREE.MathUtils.lerp(get(ix,iy),get(ix+1,iy),fx);
      const b = THREE.MathUtils.lerp(get(ix,iy+1),get(ix+1,iy+1),fx);
      return THREE.MathUtils.lerp(a,b,fy);
    };
  });
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const u=x/size, v=y/size;
    pixels[y*size+x]=Math.round(255*(0.48*grids[0](u,v)+0.32*grids[1](u,v)+0.15*grids[2](u,v)+0.05*grids[3](u,v)));
  }
  const tex = new THREE.DataTexture(pixels,size,size,THREE.RedFormat);
  tex.minFilter=tex.magFilter=THREE.LinearFilter;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.needsUpdate=true;
  return tex;
}

const sliceVertex = /* glsl */ `
uniform vec2 uAcross;
uniform vec2 uAnchor;
uniform vec3 uSunSlope;
uniform vec3 uLayout; // spacing between slices at ground, half length, volume height
varying vec3 vWorld;
void main() {
  vec2 along = vec2(-uAcross.y,uAcross.x);
  vec2 base = uAnchor + uAcross * (float(gl_InstanceID)*uLayout.x) + along * (position.x*uLayout.y);
  float h = position.y * uLayout.z;
  vWorld = vec3(base.x,0.0,base.y) + h*uSunSlope;
  gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}`;

const sliceFragment = cloudLookup + /* glsl */ `
uniform sampler2D tVisibleDepth;
uniform sampler2D tSunDepth;
uniform mat4 uShadowMatrix;
uniform vec2 uInvSize;
uniform vec2 uShadowTexel;
uniform float uWeight;
uniform bool uReadCasterDepth;
varying vec3 vWorld;
void main() {
  vec2 uv = gl_FragCoord.xy*uInvSize;
  if (gl_FragCoord.z > texture2D(tVisibleDepth,uv).r) discard;
  vec4 ls = uShadowMatrix * vec4(vWorld,1.0);
  vec3 sc = ls.xyz/ls.w;
  float lit = 1.0;
  if (uReadCasterDepth && all(greaterThan(sc,vec3(0.0))) && all(lessThan(sc,vec3(1.0)))) {
    float d = sc.z-0.00035;
    vec2 p = uShadowTexel*0.8;
    lit = 0.25*(step(d,texture2D(tSunDepth,sc.xy+p).r)+step(d,texture2D(tSunDepth,sc.xy-p).r)
      +step(d,texture2D(tSunDepth,sc.xy+vec2(p.x,-p.y)).r)+step(d,texture2D(tSunDepth,sc.xy+vec2(-p.x,p.y)).r));
  }
  float h = vWorld.y/uCloudField.w;
  float fog = smoothstep(0.0,0.15,h) * (1.0-smoothstep(0.45,1.0,h));
  float energy = uWeight * fog * opening(vWorld) * lit;
  gl_FragColor = vec4(vec3(1.0,0.82,0.55)*energy,1.0);
}`;

export function createCloudBreak(scene,camera) {
  const params = new URLSearchParams(location.search);
  const field = {value:new THREE.Vector4()};
  const sun = {value:new THREE.Vector3()};
  const mask = {value:cloudMask()};
  const shared = {tCloudMask:mask, uCloudField:field, uSunSlope:sun};
  const composite = {...shared, tCloudSlices:{value:null}};
  const uniforms = {...shared, uLayout:{value:new THREE.Vector3()}, uAcross:{value:new THREE.Vector2()},
    uAnchor:{value:new THREE.Vector2()}, uWeight:{value:0}, uInvSize:{value:new THREE.Vector2()},
    tVisibleDepth:{value:null}, tSunDepth:{value:null}, uReadCasterDepth:{value:true}, uShadowTexel:{value:new THREE.Vector2()}, uShadowMatrix:{value:new THREE.Matrix4()}};
  const mat = new THREE.ShaderMaterial({uniforms,vertexShader:sliceVertex,fragmentShader:sliceFragment,
    transparent:true,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,forceSinglePass:true,depthTest:false,depthWrite:false,toneMapped:false});
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,-1,1,0,1,1,0],3));
  geometry.setIndex([0,1,2,2,1,3]);
  const slices=new THREE.Mesh(geometry,mat);
  slices.frustumCulled=false;
  const volume=new THREE.Scene();
  volume.add(slices);
  const direction=new THREE.Vector3(), normal=new THREE.Vector3(), clear=new THREE.Color();
  const pinnedTime=params.has('cloudphase')?Number(params.get('cloudphase')):NaN;
  let light=null;
  const api={
    enabled:params.get('cloudlight')!=='0', composite,
    data:{drawn:false,slices:0,shadowMap:null,daylight:0},
    draw(renderer,depth,target,level,readCasterDepth=true) {
      if (!light) light=scene.getObjectByName('key') || scene.children.find(o=>o.isDirectionalLight&&o.castShadow);
      const shadow=light?.shadow;
      const tex=shadow?.map?.depthTexture;
      const overview=!!camera.userData.citySheetOverview;
      let daylight=(state.cloudDaylight??1)*(1-0.85*Math.min(1,state.cloudRain??0));
      if (!api.enabled || !tex || !light?.castShadow) daylight=0;
      field.value.z=daylight;
      Object.assign(api.data,{drawn:daylight>0.001,daylight,shadowMap:tex?.name??null});
      composite.tCloudSlices.value=target.texture;
      if (daylight<=0.001) {field.value.z=0;return;}
      direction.subVectors(light.position,light.target.position).normalize();
      sun.value.copy(direction).divideScalar(Math.max(0.12,direction.y));
      camera.getWorldDirection(normal);
      const viewY=normal.y;
      normal.addScaledVector(direction,-normal.dot(direction)); // face the camera as far as parallel-to-sun permits
      const across=uniforms.uAcross.value.set(normal.x,normal.z);
      if (across.lengthSq()<1e-5) across.set(1,0);
      across.normalize();
      const e=camera.matrixWorld.elements;
      const groundD=Math.abs(e[13])/Math.max(0.15,-viewY);
      const cx=e[12]-groundD*e[8], cz=e[14]-groundD*e[10];
      const radius=1.22*(groundD*Math.tan(camera.fov*Math.PI/360))*Math.hypot(camera.aspect,1/Math.max(0.24,-viewY))+(overview?8:2);
      // The wide view spans the entire sheet. More, thinner slices keep their spacing
      // below the projected height of the illuminated air during an overhead view.
      const streetSlices=level==='low'?24:level==='med'?36:48;
      const n=overview?streetSlices*2:streetSlices;
      const spacing=2*radius/(n-1), height=overview?7.5:3.8;
      const dot=cx*across.x+cz*across.y;
      const shift=Math.floor(dot/spacing)*spacing-dot-radius;
      uniforms.uAnchor.value.set(cx+across.x*shift,cz+across.y*shift);
      geometry.instanceCount=n;
      api.data.slices=n;
      field.value.set(overview?0.024:0.078,Number.isFinite(pinnedTime)?pinnedTime:state.time,daylight,height);
      uniforms.uLayout.value.set(spacing,radius*1.4,height);
      uniforms.uWeight.value=THREE.MathUtils.clamp(spacing/height,0.015,1.1)*(overview?0.125:0.19);
      uniforms.uShadowMatrix.value.copy(shadow.matrix);
      uniforms.uShadowTexel.value.set(1/shadow.mapSize.x,1/shadow.mapSize.y);
      uniforms.uInvSize.value.set(1/target.width,1/target.height);
      uniforms.tVisibleDepth.value=depth; uniforms.tSunDepth.value=tex;
      uniforms.uReadCasterDepth.value=readCasterDepth;
      renderer.getClearColor(clear);
      const alpha=renderer.getClearAlpha();
      renderer.setClearColor(0,0);
      renderer.setRenderTarget(target);
      renderer.render(volume,camera);
      renderer.setClearColor(clear,alpha);
    },
    dispose(){geometry.dispose();mat.dispose();mask.value.dispose();}
  };
  return api;
}
