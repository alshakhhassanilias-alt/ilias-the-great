import re, subprocess, sys, os, time, json, html
UA = 'Mozilla/5.0 (X11; Linux x86_64)'
os.makedirs('src', exist_ok=True)
meta = json.load(open('dvids.json')) if os.path.exists('dvids.json') else {}
for vid in sys.argv[1:]:
    out = f'src/dvids_{vid}.mp4'
    if os.path.exists(out) and os.path.getsize(out) > 200000: print('have', out); continue
    page = subprocess.run(['curl', '-sSL', '-A', UA, '--max-time', '60', f'https://www.dvidshub.net/video/{vid}'], capture_output=True, text=True).stdout
    pd = 'PUBLIC DOMAIN' in page
    title = html.unescape((re.search(r'<title>(.*?)</title>', page, re.S) or [None, '?'])[1].strip())
    links = sorted(set(re.findall(r'https://d34w7g4gy10iej\.cloudfront\.net/video/[^"\' ]+\.mp4', page)))
    print(vid, 'PD' if pd else 'NOT-PD', title[:90], links)
    meta[vid] = {'title': title, 'pd': pd, 'links': links, 'url': f'https://www.dvidshub.net/video/{vid}'}
    json.dump(meta, open('dvids.json', 'w'), indent=1)
    if not pd or not links: continue
    best = None
    for l in links:
        subprocess.run(['curl', '-sSL', '-A', UA, '--max-time', '900', '-o', out + '.tmp', l])
        p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out + '.tmp'], capture_output=True, text=True).stdout.strip()
        print('  ', l.rsplit('/', 1)[1], p, os.path.getsize(out + '.tmp') // 1000000, 'MB')
        w = int(p.split(',')[0]) if p else 0
        if best is None or w > best[0]: best = (w, l); os.replace(out + '.tmp', out)
        else: os.remove(out + '.tmp')
    meta[vid]['res'] = best[0]; json.dump(meta, open('dvids.json', 'w'), indent=1)
    time.sleep(2)
