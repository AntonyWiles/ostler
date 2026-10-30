# Security policy

## Supported versions

Ostler is released from one line. Security fixes go into the latest release, and the installed app
updates itself to it (Settings › About). Older versions do not get fixes.

| Version                    | Supported                   |
| -------------------------- | --------------------------- |
| The latest release         | Yes                         |
| Anything older             | No                          |
| Unreleased `master` builds | Best effort, before release |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it privately through GitHub:

1. Go to the repository's **Security** tab and choose **Report a vulnerability**
   ([direct link](https://github.com/AntonyWiles/ostler/security/advisories/new)).
2. Describe the problem, the version (Settings › About), and the steps to reproduce it. "Copy
   diagnostics" output helps; it has names, keys and tokens removed, but read it before you paste.

You should get an answer within a week. We will agree a fix and a disclosure date with you, and
credit you in the advisory unless you would rather not be named.

## Threat model in brief

Ostler is a desktop app that keeps all data on the person's computer. It defends that data, the
person's project folders and their secrets against other processes, web content and AI agents. These
are the boundaries; [CONTRIBUTING.md](CONTRIBUTING.md#rules-for-every-change) and [docs/architecture.md](docs/architecture.md) have the
detail.

- **Sandboxed windows.** Every window runs with `contextIsolation`, `sandbox` and no
  `nodeIntegration`, under a strict Content Security Policy. The page reaches the main process only
  through the typed `ostlerAPI` bridge, and the main process validates every id and path it receives.
  Web permissions are denied, and only `http` and `https` links open, in the browser.
- **Loopback APIs with bearer tokens.** The agent harness API and the automation API listen only on
  `127.0.0.1`, each only while its switch is on (AI agents for the harness API, Settings ›
  Connections for the automation API), and require a bearer token: each agent session's own token,
  which stops working when the session ends, or the project's automation token. Tokens can be
  regenerated in the app.
- **MCP adds reach, not power.** The MCP endpoint (`/automation/<projectId>/mcp`) is the automation
  API's own routes as tools, run in-process with the same token, validation and rights; it never
  reaches agent work, Ostler AI's settings or another project. It refuses a `Host` that is not a
  loopback name with the automation port, and an `Origin` that is not loopback, so a web page cannot
  reach it through DNS rebinding. The stdio launcher (`--mcp-stdio`) reads the encrypted token from
  the data folder, decrypts it with the same `safeStorage` key, and only forwards messages to that
  endpoint: it opens no window, takes no lock, starts no service and never opens the database. An
  assistant the person connects may send what it reads to its own AI provider; that is the person's
  choice, and revoking the token cuts it off.
- **Agents work in their own copy.** Each agent task gets its own copy of the project: a Git
  worktree on its own `ostler/<task>` version, under Ostler's data folder, never the person's folder.
  The copy's folder is labelled Windows **Low integrity**, but agents themselves run as ordinary
  processes with the person's rights: Git Bash cannot run at Low integrity, so nothing at the
  operating-system level stops an agent writing outside its copy (see `launch` in
  `electron/services/opencode-runner-service.ts`). What keeps embedded agents in their copy is the
  plugin's path check (`slot-path-check.ts`), which refuses file tools outside it; external agents
  are trusted as the person trusts them. Agent work reaches the project folder only when the person
  presses **Apply**, which saves the person's own edits first as a "Your edits" entry and adds the
  task's work as one History entry that **Undo** can reverse. Ostler never pushes and never rewrites
  history.
- **Try it runs the agent's code with the person's rights.** **Try it** in Review changes runs the
  project's try command (such as `npm run dev`) in a finished task's copy. There is no sandbox: the
  command runs as an ordinary process with the person's rights, through the same shell and
  environment as workspace setup, which never holds Ostler's keys or tokens or the built-in agent's
  own secrets. Only the person starts it, in the app, and only a command the person saved in
  Project settings runs: a command an agent suggests in its report is shown, never run, and neither
  the automation API nor any agent can set the command or start a run. Before the first run in a
  project Ostler says plainly that the agent's code will run with the person's rights. **Stop**, and
  every verdict, closing Review changes and quitting, end the command's process tree and everything
  still running from the copy (`electron/services/harness/try-it.ts`).
- **Secrets with `safeStorage`.** AI keys, the GitHub token and each project's automation token are
  encrypted in `config.json` with Electron's `safeStorage` (Windows DPAPI) and decrypted only in the
  main process (and in the stdio launcher, for its one token). Without `safeStorage` they are stored
  in plain text and encrypted on the next start where Windows can. The renderer never receives them;
  it sees whether a key is set and a masked hint. Diagnostics and logs redact them.
- **Update integrity.** Updates come from GitHub Releases over HTTPS. electron-updater checks each
  installer against the sha512 in the release's `latest.yml`, and once releases are signed, refuses
  an update not signed by the same publisher ([docs/releasing.md](docs/releasing.md#signing)).
- **Project folders are read-only** to Ostler, apart from the exceptions listed in
  [CONTRIBUTING.md](CONTRIBUTING.md#rules-for-every-change) (creating a new project folder, and applying, undoing or restoring an agent's work, each
  only when the person asks).

Out of scope: an attacker who already runs code as the same Windows user (they can read the data
folder and use DPAPI as that user), and the security of the AI providers a person chooses to use.
