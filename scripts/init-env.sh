#!/usr/bin/env bash
# Create .env from .env.example (if missing) and fill empty required secrets with random values.
#   usage: scripts/init-env.sh [env-file]   (default: .env)
# Never overwrites a secret that already has a value: changing APP_SECRET breaks enrolled 2FA,
# and changing POSTGRES_PASSWORD after the volume exists locks the app out of the database.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${1:-.env}

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi

for key in APP_SECRET POSTGRES_PASSWORD REDIS_PASSWORD; do
  # hex keeps values safe inside URLs and shell/compose interpolation
  value=$(openssl rand -hex 32)
  if grep -qE "^${key}=.+" "$ENV_FILE"; then
    echo "kept    $key (already set)"
  elif grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=\$|${key}=${value}|" "$ENV_FILE"
    echo "filled  $key"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "added   $key"
  fi
done

chmod 600 "$ENV_FILE"
