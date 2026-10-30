#!/bin/sh
# Prepares a fresh Linux machine (Ubuntu/Debian: a cloud session or a
# container) to build and test Ostler: the system packages Electron and the headless
# runner need, the npm dependencies, the Electron binary, and a build.
# Safe to run again; it skips what is already done.
#
#   sh scripts/linux-setup.sh          # npm install (keeps a cached tree)
#   sh scripts/linux-setup.sh --ci     # npm ci (a clean, exact tree)
#
# Linux is for development and testing only: Ostler ships for Windows, and its
# Windows-only parts (the Low-integrity sandbox, embedded agent sessions, the
# taskbar and installer) are skipped by the tests here, not emulated.
set -eu
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != "Linux" ]; then
  echo "linux-setup: this script is for Linux; on Windows run npm ci." >&2
  exit 1
fi

sudo=""
[ "$(id -u)" -eq 0 ] || sudo="sudo"

# xvfb gives Electron a display, dbus and gnome-keyring give safeStorage a real
# keyring (scripts/linux-headless.sh), and the rest are Electron's own libraries.
packages="xvfb xauth dbus dbus-x11 gnome-keyring libnss3 libgtk-3-0 libgbm1 libxss1 libxtst6 libdrm2 libsecret-1-0 build-essential python3 git"
# Ubuntu 24.04 renamed libasound2 to libasound2t64.
if apt-cache show libasound2t64 >/dev/null 2>&1; then
  packages="$packages libasound2t64"
else
  packages="$packages libasound2"
fi

missing=""
for package in $packages; do
  dpkg -s "$package" >/dev/null 2>&1 || missing="$missing $package"
done
if [ -n "$missing" ]; then
  echo "linux-setup: installing$missing"
  $sudo apt-get update -q
  DEBIAN_FRONTEND=noninteractive $sudo apt-get install -y -q --no-install-recommends $missing
fi

if [ "${1:-}" = "--ci" ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

# Electron 43 no longer downloads its binary on install.
npx install-electron

# A build, with better-sqlite3 compiled for Electron, so the app, the start-up
# test, e2e, the monkey and the screenshot tools can run straight away.
npm run build
npm run rebuild:native

echo "linux-setup: done. Run sh scripts/linux-test.sh for every suite."
