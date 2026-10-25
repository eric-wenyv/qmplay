#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
pnpm install --frozen-lockfile
exec pnpm build:linux "$@"
