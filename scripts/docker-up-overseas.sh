#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/deploy/docker/docker-compose.all.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI not found. Install Docker Desktop first." >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "Missing .env at repo root. Create it from .env.example first: $REPO_ROOT/.env" >&2
  exit 1
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop or the Docker service first, then rerun scripts/docker-up-overseas.sh." >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d --build

echo
echo "Services are up:"
echo "  Web:          http://127.0.0.1:5173/"
echo "  Go API:       http://127.0.0.1:8080/healthz"
echo "  Agent Runner: http://127.0.0.1:8090/healthz"
echo
