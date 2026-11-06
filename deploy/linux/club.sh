#!/usr/bin/env bash
set -euo pipefail
umask 077
CLUB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$CLUB_ROOT/ops/club-ops.sh" "$@"
