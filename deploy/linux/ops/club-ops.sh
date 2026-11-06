#!/usr/bin/env bash
set -euo pipefail
umask 077
CLUB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CLUB_ROOT"
die(){ echo "$*" >&2; exit 1; }
compose_at(){ local release="$1"; shift; ECLUB_TOOLS_DIR="${ECLUB_TOOLS_DIR:-$CLUB_ROOT/ops}" ECLUB_RELEASE_DIR="$release" ECLUB_RELEASE_ID="$(cat "$release/RELEASE_ID")" CLUB_STATE_DIR="$CLUB_ROOT/.state" docker compose --env-file "$CLUB_ROOT/.env" --project-directory "$CLUB_ROOT" -f "$release/compose.yaml" "$@"; }
compose(){ compose_at "$(realpath "$CLUB_ROOT/current")" "$@"; }
verify_release(){ (cd "$1" && sha256sum --quiet -c manifest.sha256); }
install_payload(){ local input="$1" id; verify_release "$input"; id="$(cat "$input/RELEASE_ID")"; [[ "$id" =~ ^[a-f0-9]{64}$ ]] || die 'Invalid release ID'; mkdir -p .state/releases; if [[ ! -d ".state/releases/$id" ]]; then cp -a "$input" ".state/releases/$id"; fi; verify_release ".state/releases/$id"; find ".state/releases/$id" -type d -exec chmod 755 {} +; find ".state/releases/$id" -type f -exec chmod 644 {} +; find ".state/releases/$id" -type f -name "*.sh" -exec chmod 755 {} +; printf '%s\n' "$CLUB_ROOT/.state/releases/$id"; }
dump_database(){ compose exec -T db sh -ec 'export PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"; exec pg_dump -U postgres -d electronicclub -Fc --no-owner --no-acl'; }
backup_database(){
  mkdir -p .state/backups
  local name=".state/backups/club-$(date -u +%Y%m%dT%H%M%S)-$RANDOM.dump.enc" tmp
  tmp="$name.partial"
  if ! dump_database | compose --profile ops run --rm --no-deps -T crypto encrypt >"$tmp"; then rm -f -- "$tmp"; die 'Backup failed; incomplete file removed'; fi
  mv -- "$tmp" "$name"; sha256sum "$name" >"$name.sha256"; echo "Encrypted backup: $CLUB_ROOT/$name"
}
case "${1:-help}" in
configure)
  [[ ! -e .env && ! -e current ]] || die 'Already configured; existing settings were preserved'
  domain="${2:-}"; [[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die 'Usage: ./club.sh configure club.example.com [--local-test]'
  local_test=false; [[ "${3:-}" != --local-test ]] || local_test=true
  mkdir -p .state/secrets
  for key in db_password app_password proxy_token backup_key; do [[ -f ".state/secrets/$key" ]] || openssl rand -hex 32 >".state/secrets/$key"; done
  if $local_test; then address=localhost; origin=https://localhost:18443; bind=127.0.0.1; http=18080; https=18443; tls='tls internal'; else address="$domain"; origin="https://$domain"; bind=0.0.0.0; http=80; https=443; tls=; fi
  cat >.env <<EOF
SITE_ADDRESS=$address
ALLOWED_ORIGIN=$origin
BIND_ADDRESS=$bind
HTTP_PORT=$http
HTTPS_PORT=$https
TLS_DIRECTIVE=$tls
CLUB_PROJECT=${CLUB_PROJECT:-electronicclub}
QINIU_ACCESS_KEY=
QINIU_SECRET_KEY=
QINIU_BUCKET=edwell-k12
QINIU_DOWNLOAD_DOMAIN=https://oss.gut9.cn
EOF
  release="$(install_payload "$CLUB_ROOT/payload")"; ln -s ".state/releases/$(basename "$release")" current
  echo 'Configured. Fill optional Qiniu keys in .env; run ./club.sh up when ready. No accounts were created.'
  ;;
up|backup|restore|upgrade|bootstrap|stop)
  [[ -f .env && -L current ]] || die 'Run configure first'
  exec 9>.state/operations.lock; flock -n 9 || die 'Another operation is running'
  case "$1" in
  up) compose build api web; compose up -d db --wait; compose --profile ops run --rm --no-deps -T admin migrate; compose up -d api web --wait ;;
  stop) compose stop web api ;;
  backup) backup_database ;;
  bootstrap)
    read -r -p 'Initial administrator student ID: ' student_id
    read -r -p 'Initial administrator name: ' name
    IFS= read -r -s -p 'Initial password (not stored): ' password; echo
    # Read JSON in the container; passwords never appear in argv or .env.
    printf '%s\n%s\n%s\n' "$student_id" "$name" "$password" | compose run --rm --no-deps -T --entrypoint node api -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const [studentId,name,password]=s.split("\n");const {spawn}=require("node:child_process");const p=spawn("node",["/app/bootstrap.cjs"],{stdio:["pipe","inherit","inherit"]});p.stdin.end(JSON.stringify({studentId,name,password}));p.on("exit",c=>process.exit(c??1))})'
    unset password ;;
  restore)
    file="$(realpath "${2:?backup file required}")"; [[ -f "$file" ]] || die 'Backup missing'
    plain=".state/restore-$RANDOM.dump"; trap 'rm -f -- "$plain"' EXIT
    if [[ "${3:-}" == --plain ]]; then cp -- "$file" "$plain"; replace="${4:-}"; else
      [[ -f "$file.sha256" ]] || die 'Checksum missing'; expected="$(cut -d' ' -f1 "$file.sha256")"; actual="$(sha256sum "$file" | cut -d' ' -f1)"; [[ "$expected" == "$actual" ]] || die 'Backup checksum mismatch'
      compose --profile ops run --rm --no-deps -T crypto decrypt <"$file" >"$plain" || die 'Decryption failed; original database preserved'
      replace="${3:-}"
    fi
    stage="eclub_restore_$(date -u +%s)_$RANDOM"
    compose exec -T db sh -ec 'export PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"; createdb -U postgres "$1"; exec pg_restore -U postgres -d "$1" --single-transaction --no-owner --no-acl' sh "$stage" <"$plain"
    compose --profile ops run --rm --no-deps -T -e PGDATABASE="$stage" admin migrate
    if [[ "$replace" != --replace ]]; then echo "Verified staging database: $stage. Original database unchanged. Run restore FILE --replace only for an intended migration."; exit 0; fi
    backup_database
    compose stop api
    compose --profile ops run --rm --no-deps -T -e PGDATABASE=postgres admin swap "$stage" "eclub_previous_$(date -u +%s)_$RANDOM"
    compose up -d api web --wait
    ;;
  upgrade)
    archive="${2:-}"
    mkdir -p .state/downloads
    if [[ -z "$archive" ]]; then archive="$CLUB_ROOT/.state/downloads/electronicclub-linux.tar.gz"; curl --fail --location --proto '=https' --tlsv1.2 -o "$archive" https://raw.githubusercontent.com/GUT-9/ElectronicClub/main/deployment-packages/electronicclub-linux.tar.gz; curl --fail --location --proto '=https' --tlsv1.2 -o "$archive.sha256" https://raw.githubusercontent.com/GUT-9/ElectronicClub/main/deployment-packages/electronicclub-linux.tar.gz.sha256; fi
    archive="$(realpath "$archive")"; [[ -f "$archive.sha256" ]] || die 'Release checksum missing'
    [[ "$(sha256sum "$archive" | cut -d' ' -f1)" == "$(cut -d' ' -f1 "$archive.sha256")" ]] || die 'Release checksum mismatch'
    tmp="$(mktemp -d "$CLUB_ROOT/.state/downloads/release.XXXXXX")"; trap 'rm -rf -- "$tmp"' EXIT
    tar -tzf "$archive" | while IFS= read -r item; do [[ "$item" != /* && "$item" != *'..'* && ( "$item" == payload/* || "$item" == ops/* || "$item" == club.sh || "$item" == README.md ) ]] || exit 1; done
    if tar -tvzf "$archive" | awk 'substr($0,1,1)!="-"&&substr($0,1,1)!="d"{bad=1} END{exit !bad}'; then die 'Archive links/special files refused'; fi
    tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$tmp"
    next="$(install_payload "$tmp/payload")"
    [[ "$next" != "$(realpath current)" ]] || { echo 'Already on this release; nothing changed'; exit 0; }
    compose_at "$next" build api web
    backup_database; compose stop api
    ECLUB_TOOLS_DIR="$tmp/ops" compose_at "$next" --profile ops run --rm --no-deps -T admin migrate
    ln -s ".state/releases/$(basename "$next")" current.new; mv -Tf current.new current
    cp "$tmp/club.sh" club.sh.new; mv -Tf club.sh.new club.sh
    ops_next=".state/ops.new.$RANDOM"; cp -a "$tmp/ops" "$ops_next"; mv ops ".state/ops-previous-$(date -u +%s)"; mv "$ops_next" ops
    compose up -d api web --wait
    echo 'Upgrade completed; settings, database and old code releases retained'
    ;;
  esac ;;
*) echo 'Commands: configure DOMAIN [--local-test], up, backup, restore FILE [--plain] [--replace], upgrade [ARCHIVE], bootstrap, stop' ;;
esac
