#!/usr/bin/env bash
# Stamp every local script/style reference with a version derived from the site's content,
# so browsers never mix freshly downloaded files with stale cached ones after an update.
# Run before committing changes to js/, css/, data/ or index.html.
set -euo pipefail
cd "$(dirname "$0")/.."
files=(index.html js/*.js)
v=$(cat index.html js/*.js css/*.css data/* | sed -E 's/\?v=[0-9a-z]+/?v=/g' | sha1sum | cut -c1-8)
sed -i -E "s/\?v=[0-9a-z]+/?v=$v/g" "${files[@]}"
echo "version $v"
