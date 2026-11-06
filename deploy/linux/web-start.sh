#!/bin/sh
set -eu
PROXY_TOKEN="$(cat /run/secrets/proxy_token)"
export PROXY_TOKEN
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
