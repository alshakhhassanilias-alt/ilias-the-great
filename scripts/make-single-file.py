import glob
js=open(glob.glob('dist/assets/*.js')[0]).read().replace('</script','<\\/script')
css=open(glob.glob('dist/assets/*.css')[0]).read()
open('play/world-order.html','w').write(f'''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1"><title>World Order</title><style>{css}</style></head><body><div id="root"></div><script>window.WO_MUSIC_BASE='https://raw.githubusercontent.com/alshakhhassanilias-alt/ilias-the-great/claude/jolly-pascal-bfgefn/public/music/'</script><script type="module">{js}</script></body></html>''')
