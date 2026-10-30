# Connect an AI assistant

An AI assistant or coding tool you already use can work with a project in Ostler: read its plan,
add and change tasks and milestones, record blockers and file notes in the Library. It connects
through the Model Context Protocol (MCP), which many assistants and coding tools speak. It works
whether AI agents are on or off, and the assistant can never start, stop or apply agents' work.

## Turn it on

1. Open **Settings › Connections** and turn on **Turn on the automation API**. Nothing listens
   while it is off.
2. Under **Projects**, choose the project and press **Create automation token**. Each project has
   its own token, and a token reaches only its project.
3. **Connect an AI assistant** now shows how to connect. Use the form your assistant asks for:
   - **Command (stdio)**: most desktop assistants and coding tools start a command. Press
     **Copy stdio settings** and paste them into the assistant's MCP settings. No token goes into
     them: Ostler reads it itself when the assistant starts the command, so Ostler must be running.
   - **Address (HTTP)**: an assistant that connects to an address. Press **Copy HTTP settings**.
     These carry the token, so keep them private; the screen shows the token hidden.

Restart the assistant if it reads its settings only when it starts. Ask it what tools it has from
Ostler to check that it connected.

## What the assistant can do

It has the rights of the project's automation token, and no more. It can read and change tasks,
milestones, goals and blockers, use saved views and search, log time, read the Library and add to
it, and read reports. It cannot reach other projects, AI agents' runs or Ostler AI's settings.
Everything it changes shows in the task's history as done by automation.

## Privacy

An assistant may send what it reads from Ostler to its own AI provider: that is between you and the
assistant. Connect only an assistant you trust with the project. Library items set to **Human
only** are marked as such for the assistant, but it can still read them, as the automation API can.

## Cut it off

- **Revoke** the project's token in Settings › Connections: the assistant loses access at once.
  **New token** does the same and gives the project a fresh one to connect with again.
- Turn off the automation API to disconnect every assistant from every project.

If an assistant says Ostler is not running or the automation API is off, start Ostler and check the
switch. The technical details are in the automation API docs
(`docs/automation-api/mcp.md`).
