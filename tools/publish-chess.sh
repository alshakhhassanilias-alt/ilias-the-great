#!/usr/bin/env bash
# Copies the app into a checkout of the waiter-pad branch, which GitHub Pages serves, so it
# appears at /ilias-the-great/chess/. Every file reference gets ?v=<version> so a phone never
# runs a mix of old (cached) and new files, and the header shows the version.
#
#   tools/publish-chess.sh <waiter-pad checkout> <version>
set -euo pipefail
dest="$1/chess"
v="$2"
cd "$(dirname "$0")/.."

rm -rf "$dest/js" "$dest/index.html" "$dest/style.css"
mkdir -p "$dest"
cp -r index.html style.css js "$dest/"
cp -r vendor "$dest/"

# './x.js' and '../vendor/chess.js' -> '...js?v=N' (imports and the worker URL)
sed -i -E "s#'(\.\.?/[A-Za-z0-9_./-]+\.js)'#'\1?v=$v'#g" "$dest"/js/*.js
sed -i -E "s#href=\"style\.css\"#href=\"style.css?v=$v\"#; s#src=\"js/main\.js\"#src=\"js/main.js?v=$v\"#; s#<span class=\"version\">dev</span>#<span class=\"version\">v$v</span>#" "$dest/index.html"

grep -q "main.js?v=$v" "$dest/index.html" && grep -q ">v$v<" "$dest/index.html" || { echo "stamping index.html failed" >&2; exit 1; }
echo "published version $v to $dest"
