#!/bin/sh
# Runs a command that launches Electron (Playwright e2e, the monkey, the
# screenshot tools) on a headless Linux machine, such as a cloud session or a container.
# Electron needs a display, and safeStorage needs an unlocked Secret Service
# keyring, or Ostler rightly refuses to save API keys. This gives the command a
# private session bus, a throwaway keyring in a temporary folder (never the
# user's own), and a virtual display.
#
#   sh scripts/linux-headless.sh npx playwright test -c config/playwright.config.ts
#   sh scripts/linux-headless.sh npm run monkey -- explore --steps 50
#
# Needs: xvfb, dbus, gnome-keyring (apt install xvfb dbus-x11 gnome-keyring).
set -eu
keyring_home=$(mktemp -d)
trap 'rm -rf -- "$keyring_home"' EXIT
XDG_DATA_HOME=$keyring_home dbus-run-session -- sh -c '
  echo ostler-headless | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "$@"
' linux-headless "$@"
