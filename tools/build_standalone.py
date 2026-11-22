"""Assemble the server-less browser edition: the built frontend inlined into one page, plus the Python
engine (app.zip) and the Pyodide runtime as files next to it. Usage:
  cd frontend && VITE_STANDALONE=1 npx vite build --outDir dist-standalone
  python tools/build_standalone.py <pyodide-dir> <out-dir>"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
pyo, out = Path(sys.argv[1]), Path(sys.argv[2])
dist = ROOT / "frontend" / "dist-standalone"
out.mkdir(parents=True, exist_ok=True)
html = (dist / "index.html").read_text()
js = (dist / re.search(r'src="\./(assets/[^"]+\.js)"', html).group(1)).read_text()
css = (dist / re.search(r'href="\./(assets/[^"]+\.css)"', html).group(1)).read_text()
fonts = re.search(r'<link href="(https://fonts\.googleapis\.com/[^"]+)" rel="stylesheet" />', html).group(1)
js = js.replace("</script", "<\\/script")
page = f"""<title>Infinite History</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="{fonts}" rel="stylesheet">
<style>{css}</style>
<div id="root"></div>
<script type="module">{js}</script>
"""
(out / "index.html").write_text(page)
for f in ("engine-worker.js", "provinces.topo.json"):
    shutil.copy(dist / f, out / f)
import base64, io
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted((ROOT / "backend" / "app").rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts and not p.name.endswith((".db", ".db-wal", ".db-shm")):
            z.write(p, p.relative_to(ROOT / "backend"))
# archives are shipped as base64 text and decoded in the worker (the host serves no .zip files)
(out / "app.b64.txt").write_text(base64.b64encode(buf.getvalue()).decode())
(out / "pyodide").mkdir(exist_ok=True)
for f in ("pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "pyodide-lock.json"):
    shutil.copy(pyo / f, out / "pyodide" / f)
for f in ("python_stdlib.zip", "sqlite3-1.0.0.zip"):
    (out / "pyodide" / (f + ".b64.txt")).write_text(base64.b64encode((pyo / f).read_bytes()).decode())
print("built", out, sum(p.stat().st_size for p in out.rglob("*") if p.is_file()) // 1024, "KB")
