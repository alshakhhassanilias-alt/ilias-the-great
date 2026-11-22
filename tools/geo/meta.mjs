import fs from 'fs';
import * as topo from 'topojson-client';
import * as d3 from 'd3-geo';
const t = JSON.parse(fs.readFileSync('../provinces.topo.json'));
const key = Object.keys(t.objects)[0];
const geoms = t.objects[key].geometries;
const nb = topo.neighbors(geoms);
const fc = topo.feature(t, t.objects[key]);
const out = fc.features.map((f,i)=>{
  const c = d3.geoCentroid(f);
  const area = d3.geoArea(f)*6371*6371;
  return {id:f.properties.pid, name:f.properties.pname, country:f.properties.country,
    c:[+c[0].toFixed(2),+c[1].toFixed(2)], area:Math.round(area), nb: nb[i].map(j=>geoms[j].properties.pid)};
});
fs.writeFileSync('../provinces_meta.json', JSON.stringify(out));
// rename object key to 'provinces' and save ids as feature ids
t.objects = {provinces: t.objects[key]};
t.objects.provinces.geometries.forEach(g=>{ g.id = g.properties.pid; g.properties = {}; });
fs.writeFileSync('../provinces.topo.min.json', JSON.stringify(t));
console.log(out.length, out.filter(o=>o.country==='DEU').map(o=>o.name));
