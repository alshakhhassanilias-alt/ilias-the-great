"""Finalize province metadata: population weights from Natural Earth populated places,
capital provinces, sea-crossing links, and modern country reference data.
Run from the directory containing the downloaded Natural Earth files."""
import json, math, sys
from collections import defaultdict
meta = [m for m in json.load(open('provinces_meta.json')) if m['c'][0] is not None and m['area'] > 0]
a0 = json.load(open('adm0.geojson'))['features']
places = json.load(open('places.geojson'))['features']
a1g = json.load(open('adm1_grouped.geojson'))['features']
a1_to_pid = {}
for f in a1g:
    p = f['properties']; a1_to_pid[(p['country'], p['a1'])] = p['pid']
valid = {m['id'] for m in meta}
for m in meta: m['nb'] = [n for n in m['nb'] if n in {x['id'] for x in meta}] if False else m['nb']
byc = defaultdict(list)
for m in meta: byc[m['country']].append(m)

def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 6371*2*math.asin(min(1, math.sqrt(h)))

citypop = defaultdict(float); capital = {}; bigcity = {}
for f in places:
    p = f['properties']; c = p['adm0_a3']; pt = (p['longitude'], p['latitude'])
    pid = a1_to_pid.get((c, p['adm1name']))
    if pid not in valid:
        cands = byc.get(c)
        if not cands: continue
        pid = min(cands, key=lambda m: dist(m['c'], pt))['id']
    citypop[pid] += p['pop_max'] or 0
    if (p['pop_max'] or 0) > bigcity.get(pid, (0,))[0]:
        bigcity[pid] = (p['pop_max'] or 0, p['name'], p['adm1name'] or '')
    if p['adm0cap'] == 1 and c not in capital:
        capital[c] = pid
countries = {}
for f in a0:
    p = f['properties']; c = p['ADM0_A3']
    if c not in byc: continue
    countries[c] = dict(name=p['NAME'], long=p['NAME_LONG'], pop=p['POP_EST'], gdp_md=p['GDP_MD'],
        continent=p['CONTINENT'], subregion=p['SUBREGION'], sovereign=p['SOVEREIGNT'], type=p['TYPE'])
for c, ms in byc.items():
    A = sum(m['area'] for m in ms) or 1; P = sum(citypop[m['id']] for m in ms) or 1
    for m in ms:
        m['w'] = round(0.25*(m['area']/A)**0.7/sum((x['area']/A)**0.7 for x in ms) + 0.75*citypop[m['id']]/P if P > 1 else (m['area']/A), 5)
    s = sum(m['w'] for m in ms) or 1
    for m in ms: m['w'] = round(m['w']/s, 5)
    cap = capital.get(c) or max(ms, key=lambda m: citypop[m['id']])['id']
    countries[c]['capital'] = cap
# name provinces after their dominant metropolis when the admin-1 name hides it
for m in meta:
    bc = bigcity.get(m['id'])
    if bc and bc[0] >= 1_000_000:
        a, b = bc[2].lower(), m['name'].lower()
        if not (a and (a in b or b in a)) and bc[1].lower() not in b:
            m['name'] = ' '.join(f"{bc[1]} Region".split())
# sea links: nearby non-adjacent provinces (straits / short crossings)
for m in meta:
    nb = set(m['nb'])
    ds = sorted(((dist(m['c'], o['c']), o['id']) for o in meta if o['id'] != m['id'] and o['id'] not in nb), key=lambda x: x[0])
    lim = 450 if m['nb'] else 900
    m['sea'] = [i for d, i in ds[:4] if d < lim]
json.dump({'provinces': meta, 'countries': countries}, open(sys.argv[1], 'w'), separators=(',', ':'))
print(len(meta), len(countries))
