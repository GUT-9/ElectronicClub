#!/usr/bin/env bash
set -euo pipefail
umask 077
repo="$(pwd)"
[[ -d artifacts/self-host/payload ]] || npm run build:self-host
test_root="$(mktemp -d /tmp/eclub-selfhost-check.XXXXXX)"
cp -a artifacts/self-host/. "$test_root/"
export CLUB_PROJECT="eclub-check-$RANDOM"
cleanup(){
  if [[ -L "$test_root/current" ]]; then
    release="$(realpath "$test_root/current")"
    ECLUB_TOOLS_DIR="$test_root/ops" ECLUB_RELEASE_DIR="$release" ECLUB_RELEASE_ID="$(cat "$release/RELEASE_ID")" CLUB_STATE_DIR="$test_root/.state" docker compose --env-file "$test_root/.env" -f "$release/compose.yaml" logs --tail=40 db api web >"$test_root/check.log" 2>&1 || true
    ECLUB_TOOLS_DIR="$test_root/ops" ECLUB_RELEASE_DIR="$release" ECLUB_RELEASE_ID="$(cat "$release/RELEASE_ID")" CLUB_STATE_DIR="$test_root/.state" docker compose --env-file "$test_root/.env" -f "$release/compose.yaml" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
cd "$test_root"
bash club.sh configure localhost --local-test
bash club.sh up
printf '00LINUXROOT\nLinux CI administrator\nLinux-Test123\n' | bash club.sh bootstrap
release="$(realpath current)"
ECLUB_TOOLS_DIR="$test_root/ops" ECLUB_RELEASE_DIR="$release" ECLUB_RELEASE_ID="$(cat "$release/RELEASE_ID")" CLUB_STATE_DIR="$test_root/.state" docker compose --env-file .env -f "$release/compose.yaml" cp web:/data/caddy/pki/authorities/local/root.crt "$test_root/ca.crt"
NODE_EXTRA_CA_CERTS="$test_root/ca.crt" node "$repo/tests/self-host-smoke.mjs" seed
bash club.sh backup
backup="$(find .state/backups -maxdepth 1 -name '*.dump.enc' | head -1)"
cp "$backup" .state/bad-backup.enc
node -e 'const fs=require("node:fs");const p=process.argv[1],b=fs.readFileSync(p);b[b.length-1]^=1;fs.writeFileSync(p,b)' .state/bad-backup.enc
sha256sum .state/bad-backup.enc >.state/bad-backup.enc.sha256
if bash club.sh restore .state/bad-backup.enc >.state/tamper-check.log 2>&1; then echo 'Tampered backup was accepted' >&2; exit 1; fi
NODE_EXTRA_CA_CERTS="$test_root/ca.crt" node "$repo/tests/self-host-smoke.mjs" mutate
bash club.sh restore "$backup" --replace
NODE_EXTRA_CA_CERTS="$test_root/ca.crt" node "$repo/tests/self-host-smoke.mjs" restored
# The previous database is retained; a same-release upgrade is an actual no-op.
cd "$repo"
node --input-type=module -e 'import {archive} from "./scripts/release-refresh.mjs";import {files} from "./scripts/build-self-host.mjs";await archive("artifacts/self-host",await files("artifacts/self-host"),"artifacts/selfhost-check.tar.gz")'
cd "$test_root"
bash club.sh upgrade "$repo/artifacts/selfhost-check.tar.gz"
cd "$repo"
node tests/prepare-self-host-upgrade.mjs
cd "$test_root"
sha256sum .env .state/secrets/* >.state/config-before.sha256
bash club.sh upgrade "$repo/artifacts/selfhost-upgrade-check.tar.gz"
sha256sum --quiet -c .state/config-before.sha256
NODE_EXTRA_CA_CERTS="$test_root/ca.crt" node "$repo/tests/self-host-smoke.mjs" restored
echo 'PASS Linux HTTPS, native PG17, login/RBAC, SPA/API routing, encrypted backup/restore and no-op upgrade; isolated test data only'
