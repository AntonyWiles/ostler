# Ostler sync server

A small server an organisation can run so its people share Ostler projects without a synced
folder. It is one file, `server.mjs`, for Node 22 or later, with no packages.

## What it can and can't see

Ostler encrypts and signs every file it writes with the project's key, which only the invite
carries. The server keeps those files and refuses to overwrite one; it can't read them. It sees
how many files each project has, their sizes and names (random IDs), when they were written, and
who signed in to write them.

Each shared project gets its own space, `/spaces/<random id>`. Anyone who can sign in to the server
can reach any space whose ID they know; only people with the invite can read what is in it.

## Running it

```bash
OSTLER_SYNC_KEYS=a-long-random-key node server.mjs
```

Or with Docker:

```bash
docker build -t ostler-sync .
docker run -d -p 8080:8080 -v ostler-sync:/data -e OSTLER_SYNC_KEYS=a-long-random-key ostler-sync
```

Put it behind HTTPS: a reverse proxy such as Caddy, nginx or Azure App Service, or set `TLS_CERT`
and `TLS_KEY`. Ostler talks to a sync server only over `https://`, except on the same computer.

| Setting                 | What it does                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `PORT`                  | The port to listen on. 8080 unless set.                                                             |
| `OSTLER_SYNC_DATA`      | The folder files are kept in. `./data` unless set. Back it up.                                      |
| `OSTLER_SYNC_KEYS`      | Access keys, separated by commas. Make each one long and random, such as `openssl rand -base64 32`. |
| `OSTLER_SYNC_KEYS_FILE` | A file with one access key per line, in place of or as well as the above.                           |
| `OSTLER_SYNC_TENANT`    | Your Microsoft Entra tenant ID (a GUID), to sign in with work accounts.                             |
| `OSTLER_SYNC_AUDIENCE`  | The server's app registration: its application ID URI or client ID, or both separated by a comma.   |
| `TLS_CERT`, `TLS_KEY`   | A certificate and key, to serve HTTPS itself.                                                       |

## Signing in with Microsoft work accounts

1. In Microsoft Entra, register an app for the server. Under **Expose an API**, set the application
   ID URI (for example `api://ostler-sync`) and add a scope, `sync`.
2. Under **Authorized client applications**, add the app registration your Ostler policy uses for
   Microsoft accounts, so people aren't asked to consent.
3. Run the server with `OSTLER_SYNC_TENANT` and `OSTLER_SYNC_AUDIENCE` (`api://ostler-sync` and the
   server app's client ID).
4. In the policy, set the sync server's `signIn` to `microsoft` and `scope` to
   `api://ostler-sync/sync`. People connect their work account in Settings › Connections ›
   Accounts and choose it under Sync server.

## Telling Ostler about it

People can enter the address and their access key in **Settings › Connections › Sync server**. An
organisation can set the address for everyone in its policy, in
`%ProgramData%\Ostler\policy.json`:

```json
{
  "syncServer": { "url": "https://sync.example.com", "signIn": "key" }
}
```

or as `SyncServerUrl`, `SyncServerSignIn` and `SyncServerScope` under
`HKLM\Software\Policies\Ostler`. The full policy is described in
`docs/user-guide/18-privacy.md` under "Organisation policy".
