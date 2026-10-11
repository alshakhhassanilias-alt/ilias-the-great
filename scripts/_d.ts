import { loadGeo } from '../src/sim/load';
const geo = loadGeo();
let ds:number[]=[]; for (let p=0;p<geo.provinces.length;p++) for (const q of geo.adj[p]) if(q>p) ds.push(geo.dist(p,q));
ds.sort((a,b)=>a-b); console.log('adj dist p10,p50,p90', ds[ds.length*0.1|0], ds[ds.length/2|0], ds[ds.length*0.9|0], 'n', ds.length);
const comps:number[]=[]; 
console.log('provinces', geo.provinces.length, 'avg adj', ds.length*2/geo.provinces.length);
