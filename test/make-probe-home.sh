#!/bin/sh
# Rebuild the throwaway DSH home used by `bun run verify:compose`.
# It lives under the git-ignored tmp/ and never touches the real $DSH_HOME.
set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pkg=$(dirname -- "$here")
home="$pkg/tmp/probe-home"
rm -rf "$home"
mkdir -p "$home/profiles/web/node_modules"
ln -sfn "$pkg" "$home/profiles/web/node_modules/dsh-simple-usage-info"
cat > "$home/profiles/web/package.json" <<JSON
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "dsh-simple-usage-info": "link:$pkg" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-simple-usage-info"
      ]
    }
  }
}
JSON
echo "probe home ready: $home"
