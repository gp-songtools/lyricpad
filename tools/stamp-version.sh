#!/usr/bin/env bash
# Stamp the site with a version derived from its content:
#  - every local script/style reference gets "?v=<version>", so browsers never mix freshly
#    downloaded files with stale cached ones after an update;
#  - the footer shows "Version <version> · <date>" (clickable: checks whether a newer one is live).
# The date only changes when the content does. Run before committing changes to the site.
set -euo pipefail
cd "$(dirname "$0")/.."

# The stamps themselves are left out of the hash.
strip='s/\?v=[0-9a-z]+/?v=/g; s/data-build="[^"]*"/data-build=""/g; s/data-date="[^"]*"/data-date=""/g; s/>Version [^<]*</>Version </g'
v=$(cat index.html help.html privacy.html terms.html js/*.js css/*.css data/* | sed -E "$strip" | sha1sum | cut -c1-8)

old=$(grep -oE 'data-build="[0-9a-f]*"' index.html | head -1 | sed -E 's/.*"(.*)"/\1/' || true)
d=$(grep -oE 'data-date="[^"]*"' index.html | head -1 | sed -E 's/.*"(.*)"/\1/' || true)
if [ "$old" != "$v" ] || [ -z "$d" ]; then d=$(date -u +%Y-%m-%d); fi

sed -i -E "s/\?v=[0-9a-z]+/?v=$v/g" index.html js/*.js
sed -i -E "s/data-build=\"[^\"]*\"/data-build=\"$v\"/; s/data-date=\"[^\"]*\"/data-date=\"$d\"/; s/>Version [^<]*</>Version $v · $d</" index.html
echo "version $v ($d)"
