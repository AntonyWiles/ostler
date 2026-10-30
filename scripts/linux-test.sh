#!/bin/sh
# Runs Ostler's checks and test suites on Linux, in the order that keeps
# better-sqlite3 built for the right runtime: the unit and integration tests
# need it built for Node, the start-up test and e2e need it built for Electron.
# Run scripts/linux-setup.sh once first.
#
#   sh scripts/linux-test.sh              # everything
#   sh scripts/linux-test.sh static node  # only these stages
#
# Stages: static (typecheck, lint, format), node (unit, components,
# integration), electron (start-up smoke test, e2e). Windows-only tests skip
# themselves here (process.platform checks), so nothing Windows-specific runs.
# It ends with better-sqlite3 built for Electron, ready for the monkey and the
# screenshot tools (scripts/linux-headless.sh).
set -eu
cd "$(dirname "$0")/.."

stages=${*:-static node electron}

for stage in $stages; do
  echo "== linux-test: $stage"
  case "$stage" in
    static)
      npm run typecheck
      npm run lint
      npm run format:check
      ;;
    node)
      npm test
      npm run test:components
      npm run test:integration
      ;;
    electron)
      npm run build
      npm run rebuild:native
      sh scripts/linux-headless.sh npx vitest run tests/integration/startup-smoke.test.ts
      sh scripts/linux-headless.sh npx playwright test
      ;;
    *)
      echo "linux-test: unknown stage '$stage' (static, node, electron)" >&2
      exit 1
      ;;
  esac
done

echo "== linux-test: all passed"
