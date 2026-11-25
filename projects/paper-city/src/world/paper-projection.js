import * as THREE from 'three';

// A physical rotation in the horizontal plane swaps the two projected foreshortening axes.
// Calibrate the broad paper view against the previous camera's reference plane so that each
// direction in the old image advances exactly a clockwise quarter turn on the display.
export function createPaperProjection(reliefHeight){
  const axisX=new THREE.Vector3(1,.025,0),axisZ=new THREE.Vector3(0,.025,1),origin=new THREE.Vector3(0,.025,0);
  const projection=new THREE.Matrix4(),identity=new THREE.Matrix4(),correction=new THREE.Matrix4();
  const source=new THREE.PerspectiveCamera(36,1,.12,500),dest=source.clone();
  let lastAspect=-1;
  function frame(c,aspect,size,x,y,z){
    const target=new THREE.Vector3(0,0,1.8);
    c.aspect=aspect;c.updateProjectionMatrix();
    c.position.set(x,y,z).normalize().multiplyScalar(size/(2*Math.tan(Math.PI/10))).add(target);
    c.lookAt(target);c.updateMatrixWorld(true);
  }
  function frameAxes(c){
    const o=origin.clone().project(c);
    function direction(pt){
      const v=pt.clone().project(c);return new THREE.Vector2((v.x-o.x)*c.aspect,o.y-v.y);
    }
    return [direction(axisX),direction(axisZ)];
  }
  function refresh(aspect){
    lastAspect=aspect;
    frame(source,aspect,Math.max(86/Math.max(.4,aspect),56),.06,.91,.43);
    const size=Math.max(78,49.15*1.18/Math.max(.4,aspect),(68.4*.94+reliefHeight*.49)*1.14+6);
    frame(dest,aspect,size,.055,1.01,.38);
    const [sourceU,sourceV]=frameAxes(source),[east,south]=frameAxes(dest);
    // Directions around a plane origin use the homogeneous tangent, with finite depth removed.
    function tangent(c,v,point){const view=point.clone().applyMatrix4(c.matrixWorldInverse);return v.multiplyScalar(-view.z);}
    tangent(source,sourceU,axisX);tangent(source,sourceV,axisZ);tangent(dest,east,axisX);tangent(dest,south,axisZ);
    const a=south.x,b=-east.x,c=south.y,d=-east.y,det=a*d-b*c;
    const u=-sourceU.y,v=-sourceV.y,w=sourceU.x,t=sourceV.x;
    let A=(u*d-v*c)/det,B=(v*a-u*b)/det,C=(w*d-t*c)/det,D=(t*a-w*b)/det;
    const scale=1/Math.sqrt(A*D-B*C);A*=scale;B*=scale;C*=scale;D*=scale;
    correction.set(A,-B/aspect,0,0,-C*aspect,D,0,0,0,0,1,0,0,0,0,1);
  }
  return function apply(camera,strength){
    if(camera.aspect!==lastAspect)refresh(camera.aspect);
    camera.updateProjectionMatrix();
    if(strength<=0)return;
    const out=projection.elements,base=identity.elements,desired=correction.elements;
    for(let i=0;i<16;i++)out[i]=base[i]+(desired[i]-base[i])*strength;
    camera.projectionMatrix.premultiply(projection);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
}
