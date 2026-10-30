# Automation API: MCP

Part of the [Ostler Automation API](README.md). An AI assistant or coding tool that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) can use a project through the
automation API without anyone writing HTTP calls: each API route is an MCP tool. MCP adds reach,
not power. A tool has exactly the rights of the route it stands for, and the token's: one project,
the automation agent's rights ([CONTRIBUTING.md](../../CONTRIBUTING.md#agents-the-harness-and-ostler-ai)).

MCP works while the automation API is on (Settings › Connections, **Turn on the automation API**),
whether AI agents are on or off. The project needs an automation token, created in the same place.
Settings › Connections › **Connect an AI assistant** shows the address, the command and client
settings for both forms below, ready to paste; **Copy** puts the full text on the clipboard.

## Two ways to connect

### Streamable HTTP

```
POST http://127.0.0.1:<port>/automation/<projectId>/mcp
Authorization: Bearer <automation token>
```

The endpoint speaks MCP's Streamable HTTP transport, statelessly: every `POST` carries JSON-RPC
messages and is answered with JSON. There are no sessions, so `GET` and `DELETE` answer `405`.
Client settings in the `mcpServers` shape most clients read:

```json
{
  "mcpServers": {
    "ostler-house-move": {
      "type": "http",
      "url": "http://127.0.0.1:8935/automation/<projectId>/mcp",
      "headers": { "Authorization": "Bearer <automation token>" }
    }
  }
}
```

Requests are refused before the token is checked when:

- they do not come from this computer (the API listens only on `127.0.0.1` anyway);
- the `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` with the automation port
  (`403`);
- they carry an `Origin` header that is not a loopback address (`403`). Together these stop a web
  page from reaching the endpoint through DNS rebinding.

A missing token, a wrong one or another project's answers `401`. Bodies have the API's limits.

### stdio

Many clients start a local server as a command and talk to it over stdin and stdout. The Ostler
executable is that command:

```
"C:\Program Files\Ostler\Ostler.exe" --mcp-stdio --project <projectId>
```

```json
{
  "mcpServers": {
    "ostler-house-move": {
      "command": "C:\\Program Files\\Ostler\\Ostler.exe",
      "args": ["--mcp-stdio", "--project", "<projectId>"]
    }
  }
}
```

No token goes into the client's settings. The launched process reads the automation port and the
project's token from Ostler's data folder, as it is at each message, decrypts the token with the
same Windows protection Ostler stored it with (so it works only for the Windows user who runs
Ostler), and forwards every message to
the running Ostler's HTTP endpoint above. It takes no lock, opens no window, starts no service and
never opens the database. When Ostler is not running, the automation API is off, or the project has
no token (or one this Windows user cannot decrypt), each request gets an MCP error that says so (code `-32000`). An Ostler whose data folder
was moved with `OSTLER_USER_DATA` gets the same variable in the client settings' `env`; Settings
writes it for you. A development build's command also names the app folder and the data folder.

The process prints one empty line before the first message: Electron itself writes it at start-up,
before any of Ostler's code runs. Clients built on the official TypeScript SDK, such as the MCP Inspector,
skip it.

## Tools

Tools are generated from the automation API's route table (`HELP_ROUTES` in
`electron/services/automation-http-server.ts`), the same table `GET /help` returns. Nothing lists
them a second time: a route added to the table is a tool from then on. Each tool call runs that
route's handler inside Ostler, with the same token check, validation, refusals, audit and
`automation` actor as an HTTP request.

- **Name:** the method and path, lowercase with `_`: `GET /work-items` is `get_work_items`,
  `PATCH /work-items/:workItemId` is `patch_work_items_by_work_item_id`.
- **Description:** the route's description, its method and path, and its request and response.
- **Arguments:** each path parameter by name (required), `query` for query-string options (string,
  number or true/false values), and `body` for the JSON body on routes that are not `GET`. The
  route's own documentation says what `query` and `body` hold.
- **Result:** the route's `value` as JSON text. A refusal (`ok: false`) is a tool error
  (`isError: true`) with the API's `error` as its text. A route that returns a file returns its text
  (CSV, calendar, HTML), an image, or the file as an embedded blob, up to the Library's 25 MB.
- **Annotations:** `GET` tools are read-only, `DELETE` tools destructive.

What a project's tools cover: goals, milestones, tasks (work items, their fields, labels, columns,
checklists, comments, reminders, recurrence and history), blockers and dependency conflicts,
filtering, search and saved views, time entries and the timer, the Library (the automation agent's
rights: the whole Library, with items set to Human only marked `humanOnly`; create, upload,
attach and archive), people, templates, CSV import and its undo, export, reports and status, and reading
the project's conventions.

## What is not a tool, and why

| Not a tool                                                                                                                                          | Why                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every route under `/tasks`, `/sessions`, `/questions`, `/events`, `/auto-dispatch`, `/report`, `/workspace-setup`, `/agent-runs` and `/agent-usage` | They queue, start, stop, apply, discard or answer agent work, set how agents run, or report on agent runs. A route added under one of these later stays out by itself. |
| `autoQueue: true` anywhere in a tool's body                                                                                                         | It queues a task for agents. The call is refused before it reaches the route.                                                                                          |
| `goToAgents: true` anywhere in a tool's body                                                                                                        | It sends a repeating task's occurrences to agents. The call is refused before it reaches the route.                                                                    |
| `cancelQueuedWork: true` anywhere in a tool's body                                                                                                  | It cancels work queued for agents. The call is refused before it reaches the route.                                                                                    |
| `planFirst` anywhere in a tool's body                                                                                                               | Whether a task plans first is how agent work runs. The call is refused before it reaches the route.                                                                    |
| `POST /task-templates/:templateId/run`                                                                                                              | Running a playbook queues its task for agents.                                                                                                                         |
| `GET /projects`                                                                                                                                     | It lists every project; an MCP connection reaches one project only.                                                                                                    |
| `GET /areas`                                                                                                                                        | Areas group every project; an MCP connection reaches one project only.                                                                                                 |
| `GET /help`                                                                                                                                         | MCP lists its own tools.                                                                                                                                               |
| `GET /ai-settings`, `PATCH /ai-settings`                                                                                                            | Ostler AI's settings are not planning.                                                                                                                                 |
| `PATCH /conventions`, `POST /lessons`, `PATCH /lessons/:lessonId`, `DELETE /lessons/:lessonId`                                                      | Conventions and lessons are read only over MCP.                                                                                                                        |
| `POST /import/project`                                                                                                                              | Its body is the project file itself, which a tool call cannot carry.                                                                                                   |

A route the table marks `mcp: { excluded: '<why>' }` is left out the same way. There is no route
about tokens, and no token that reaches every project. MCP prompts, sampling and resources are not
offered: tools only.

## Privacy

An assistant connected over MCP may send whatever it reads from Ostler to its own AI provider. Ostler
sends nothing anywhere itself; the assistant decides. Connect only an assistant you trust with the
project, and revoke the project's token (Settings › Connections) to cut it off at once.
