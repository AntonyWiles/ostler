/**
 * The command line for an Electron launched by Playwright. Off Windows two
 * switches are needed: containers usually run as root, where Chromium's sandbox will not
 * start, and a headless session has no desktop to pick a keyring from, so the
 * GNOME one is named (`scripts/linux-headless.sh` starts it, unlocked).
 */
export function electronArgs(appRoot: string): string[] {
  return process.platform === 'linux'
    ? ['--no-sandbox', '--password-store=gnome-libsecret', appRoot]
    : [appRoot]
}
