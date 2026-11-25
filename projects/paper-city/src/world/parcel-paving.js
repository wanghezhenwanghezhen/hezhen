import * as THREE from 'three';

export async function fetchParcelPaving() {
  const url=name=>new URL('parcel-paving/'+name,document.baseURI).href;
  const loader=new THREE.TextureLoader();
  const [color,roughness,stats]=await Promise.all([
    loader.loadAsync(url('ground.webp')),loader.loadAsync(url('roughness.png')),
    fetch(url('index.json')).then(r=>{if(!r.ok)throw Error('无法读取地块铺地索引 '+r.status);return r.json();})
  ]);
  color.colorSpace=THREE.SRGBColorSpace;color.name='Qianyu parcel source albedo';color.anisotropy=4;
  roughness.colorSpace=THREE.NoColorSpace;roughness.name='Qianyu parcel source roughness';roughness.anisotropy=4;
  return {color,roughness,stats};
}

export function attachParcelPaving(wfc,{color,roughness,stats}) {
  if(stats.parcels!==wfc.plan.parcels.length||color.image.width!==stats.rasterSize[0]||color.image.height!==stats.rasterSize[1])throw Error('地块铺地与规划版本不匹配');
  wfc.print.parcelPaving=color;wfc.print.parcelRoughness=roughness;wfc.parcelPaving=stats;
  return stats;
}
