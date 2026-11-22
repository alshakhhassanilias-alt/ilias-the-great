import json, math, random
from collections import defaultdict, Counter
a0 = json.load(open('adm0.geojson'))['features']
a1 = json.load(open('adm1.geojson'))['features']
REMAP = {'ESB':'CYP','WSB':'CYP','USG':'CUB','GIB':'ESP','KAB':'KAZ','CLP':None,'CSI':None,'PGA':None,'UMI':None}
countries = {f['properties']['ADM0_A3']: f['properties'] for f in a0}
A1POP = defaultdict(float)
for _f in json.load(open('places.geojson'))['features']:
    _p = _f['properties']; A1POP[(_p['adm0_a3'], _p['adm1name'])] += _p['pop_max'] or 0

def ring_area(r):
    # approximate km^2 equirectangular
    s=0
    for i in range(len(r)-1):
        x1,y1=r[i]; x2,y2=r[i+1]
        s += (x1*y2-x2*y1)
    lat = sum(p[1] for p in r)/len(r)
    return abs(s)/2 * (111.32**2) * math.cos(math.radians(lat))

def geom_area_centroid(g):
    polys = g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    A=0; cx=0; cy=0
    for p in polys:
        a = ring_area(p[0])
        xs=[q[0] for q in p[0]]; ys=[q[1] for q in p[0]]
        A+=a; cx+=a*sum(xs)/len(xs); cy+=a*sum(ys)/len(ys)
    if A==0: return 0,(0,0)
    return A,(cx/A,cy/A)

by = defaultdict(list)
for f in a1:
    p=f['properties']; c=p['adm0_a3']
    if c in REMAP:
        c=REMAP[c]
        if c is None: continue
    if f['geometry'] is None: continue
    A,cen = geom_area_centroid(f['geometry'])
    by[c].append(dict(f=f, area=A, cen=cen, name=p['name'] or p['name_en'] or p['gn_name'] or c, region=p.get('region') or ''))

def kmeans(units, k, seed=7):
    pts=[u['cen'] for u in units]
    rnd=random.Random(seed)
    # init: farthest point, weighted by area
    order=sorted(range(len(units)), key=lambda i:-units[i]['area'])
    cents=[pts[order[0]]]
    while len(cents)<k:
        best=max(range(len(pts)), key=lambda i: min((pts[i][0]-c[0])**2+(pts[i][1]-c[1])**2 for c in cents))
        cents.append(pts[best])
    for _ in range(30):
        assign=[min(range(k), key=lambda j:(pts[i][0]-cents[j][0])**2*math.cos(math.radians(pts[i][1]))**2+(pts[i][1]-cents[j][1])**2) for i in range(len(pts))]
        new=[]
        for j in range(k):
            m=[units[i] for i in range(len(pts)) if assign[i]==j]
            if not m: new.append(cents[j]); continue
            W=sum(u['area']+1 for u in m)
            new.append((sum(u['cen'][0]*(u['area']+1) for u in m)/W, sum(u['cen'][1]*(u['area']+1) for u in m)/W))
        cents=new
    return assign

out=[]; stats={}
for c, units in by.items():
    total=sum(u['area'] for u in units)
    T=max(1,min(40,round(math.sqrt(total)/70)))
    n=len(units)
    if n<=T:
        groups=[[u] for u in units]
    else:
        regs=Counter(u['region'] for u in units)
        if '' not in regs and T/2 <= len(regs) <= T*2.2 and len(regs)>1:
            g=defaultdict(list)
            for u in units: g[u['region']].append(u)
            groups=list(g.values())
            for gr in groups:
                gr[0]['gname']=gr[0]['region']
        else:
            asg=kmeans(units,T)
            g=defaultdict(list)
            for u,a in zip(units,asg): g[a].append(u)
            groups=[v for v in g.values() if v]
    stats[c]=len(groups)
    names=Counter()
    for i,gr in enumerate(groups):
        gname = next((u.get('gname') for u in gr if u.get('gname')), None)
        gr.sort(key=lambda u:-(A1POP.get((c, u['name']), 0) + u['area']/50))
        nm = gname or gr[0]['name']
        names[nm]+=1
        if names[nm]>1: nm=f"{nm} {names[nm]}"
        key=f"{c}-{i:02d}"
        for u in gr:
            out.append({'type':'Feature','geometry':u['f']['geometry'],'properties':{'pid':key,'country':c,'pname':nm,'a1':u['name']}})
json.dump({'type':'FeatureCollection','features':out}, open('adm1_grouped.geojson','w'))
print(sum(stats.values()), sorted(stats.items(), key=lambda x:-x[1])[:25])
missing=[c for c in countries if c not in by]
print('missing',missing)
