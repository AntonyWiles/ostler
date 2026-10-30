# Sharing a project

You can work on one project with other people, or on your own other PCs, through a folder you
already keep in sync: a OneDrive, Dropbox or Google Drive folder, or a network share. There is no
Ostler server and no account. Each PC keeps its own copy of the project and works without a
connection. Changes travel through the folder when it syncs.

## What is shared

Everything in the project:

- tasks, with their comments, checklists, dependencies, fields and time;
- milestones, goals, iterations, saved views, baselines and rules;
- costs, budgets, billing and status updates;
- Library items, including their files, and decisions;
- the project's name, colour, notes, tags and task prefix.

Also shared are the people the project's tasks are assigned to, and the people named in its
records. Renaming one of them renames them for everyone in the project.

These stay on your PC:

- the project's linked folder on your disk;
- your contacts, and which contacts a task is linked to;
- which person is **Me**;
- your settings, and your Ostler AI and agent setup;
- your other projects.

## Sharing a project

1. Open the project's settings and choose **Sharing**.
2. Press **Share this project…**. When OneDrive, Google Drive or Dropbox is on this PC, choose
   which one and press **Share it here**: Ostler makes a new folder for the project in it, named
   after the project. Or choose **Another folder…** and pick an empty folder you keep in sync.
   Some folders can't hold files, such as the top of a Google Drive letter: choose a folder in
   **My Drive** instead.
3. Ostler writes the project there and copies an **invite message** to the clipboard. If sharing
   can't finish, nothing is kept and you can try again.
4. Share the folder with the other person in OneDrive, Dropbox or Google Drive, as you normally
   would. **Open the folder** in **Sharing** shows it in File Explorer.
5. Paste the invite message into an email or chat to them. It tells them how to add the folder in
   the sync app you used, and has a link that opens Ostler's join screen.

Anyone with both the folder and the invite can open the project. Treat the invite like a password.
Under **Invite as**, choose a role before you press **Copy invite**: **Can edit** (the default),
**Contributor** or **Can view**. The invite gives the person that [role](#roles), and a line under
the choice says what it allows. **Copy invite** copies the message again whenever you need it.

Owners and Editors can invite. An Editor can invite people as Editor, Contributor or Viewer, but
not as Owner. Until everyone in the project has the latest version of Ostler, an Editor's invite
controls are switched off with a note saying why.

### Email an invite

Ostler can email the invite message for you, through your own email server:

1. In Settings › Connections › Email, choose **Set up email…** and enter your provider's SMTP
   server (such as `smtp.office365.com` or `smtp.gmail.com`), its connection (**STARTTLS** on port
   587 or **TLS** on 465), your user name and password, and the address to send from. Many
   providers want an app password, made in your account's security settings. The password is
   encrypted on this PC and never shown again.
2. **Send a test email** sends one to your own address, to check it works.
3. In **Sharing**, choose who it's for under **Invite as**, press **Email invite**, type their
   address and press **Email invite** again.

The email holds the same message as **Copy invite**, so treat it the same way. Without an email
server set up, **Email invite** says where to set one up.

## Roles

Each person in a project has one role:

- **Owner** can do everything an Editor can, and also change anyone's role, remove people and stop
  old invites. The person who shares a project is its first Owner.
- **Editor** can change the project: its tasks, records, Library and settings. An Editor can also
  invite people, as Editor, Contributor or Viewer.
- **Contributor** can work on the tasks assigned to them, log their own time and comment. A
  Contributor can't add other tasks, edit other people's tasks, or change the project's records or
  settings. Contributor is offered only when everyone in the project has the latest version of
  Ostler: until then it shows **Everyone needs the latest version of Ostler** and can't be chosen.
- **Viewer** can read the project and comment. Changes to tasks, records and settings are refused
  on a Viewer's PC, and the project shows **You can view this project. Ask an owner to edit.**

A Contributor sees a note at the top of the project: "You're a Contributor: you can work on tasks
assigned to you, log your time and comment."
On a task that isn't theirs, a Contributor (or a Viewer) sees the task's fields greyed out with a
note saying it is read-only, and **New task** is greyed out too. Comments, time and sign-offs stay
available.

### What each role can do

**What each role can do** in **Sharing** is a table every member can open. A row is a thing a
person might do, and each role says **Yes** or **No**. The rows are **Invite people**, **Change
people's roles**, **Remove people**, **Edit project settings**, **Add tasks**, **Edit any task**,
**Edit tasks assigned to them**, **Delete tasks**, **Edit the Library**, **Comment**, **Pin
comments**, **Delete anyone's comments**, **Log their own time**, **Ask for a sign-off** and
**Answer sign-offs asked of them**. In short:

- Owners and Editors can do the work on the project. Owners alone change roles and remove people.
- Contributors can edit the tasks assigned to them, comment, log their own time and ask for a
  sign-off.
- Viewers can comment, and answer a sign-off if someone asks them.

To change someone's role, open **Sharing** as an Owner and choose a new role from the list beside
their name. Only Owners see **Remove…**. A change of role reaches the other PCs when the folder
syncs.

### History

**History** in **Sharing** lists, newest first and with dates, who started sharing the project,
who joined, who left, who was removed, who changed whose role, and when all earlier invites were
stopped. Every member can read it.

### Stopping old invites

An invite works for anyone who has it, however long ago it was sent. As an Owner, press **Stop old
invites** in **Sharing** and confirm to make every invite sent so far stop working. People already
in the project aren't affected, but anyone you invited who hasn't joined yet needs a new invite
(copy a new one). **Sharing** then says "Invites sent before … no longer work." This is offered
only when everyone has the latest version of Ostler, and until then it says so.

### Showing when you are away

Under **Show when I'm away to people in this project**, switch on sharing of your away days. The
project's other members then see your coming days off, in [Workload](05-home-and-inbox.md#workload)
and the [Team view](33-teams.md), as **Away**. Only the dates are shared, never the names (so not
"Dentist"), and only while they are still ahead. Bank holidays aren't part of it. Switch it off
and they are taken away again. Nobody else can change your dates.

### Through a sync server

If your organisation runs an Ostler sync server, or you run one yourself, set it up once in
**Settings › Connections › Sync server**: its address, and the access key you were given or the
Microsoft work account you sign in with. Your organisation may have set the address for you.

**Sharing** then also offers **Share through the server**. There is no folder to choose: the project
is kept on the server, encrypted with the project's key, so the server can't read it. The invite
says which server it is on, so whoever joins needs only the invite and a sign-in to that server.
The server's code and how to run it are in `server/sync-server/` in Ostler's source.

### Through Google Drive

You can also keep a shared project in your own Google Drive, with no folder on your PC. Connect a
Google account once in **Settings › Connections › Accounts** and turn on **Sync projects through
Google Drive**. If it isn't connected, **Sharing** says so and has an **Open Accounts** button.

1. Open the project's **Sharing** and press **Share through Google Drive**. Ostler makes a folder
   for the project in its own folder in your Drive, and writes the project into it, encrypted with
   the project's key, so Google can't read it.
2. To let a teammate in, type their Google email address under **Give access**, choose **Can edit**
   or **Can view**, and press **Give access**. Google emails them a link to the folder, and the
   invite goes on your clipboard. Send it to them by email or chat.
3. Whoever you invite connects their own Google account the same way, then joins from the invite
   (see below). There is no folder to find: the invite says where the project is.

Only the project's Owner can give access. Ostler only reads and writes its own folder in your Drive, not
the rest of it.

## Joining a shared project

1. Start a **New project** and choose **Join a shared project**.
2. Paste the whole message you were sent, or just its link or invite: Ostler finds the invite in
   it. You can also open the invite's link:
   Ostler opens the join screen with the invite already filled in.
3. Ostler looks for the shared folder on this PC. If it has not arrived yet, the screen says
   **Looking for the shared folder on this PC…** and checks again every 15 seconds. Do step 1 of
   the message you were sent so the folder syncs to this PC: in Google Drive, open the folder and
   choose **Organize › Add shortcut to My Drive**; in OneDrive, choose **Add shortcut to My
   files**; in Dropbox, accept the shared folder.
4. When Ostler finds the folder, the project joins. You don't need to choose the folder yourself.
   If you keep it somewhere Ostler can't find, press **Choose the folder myself…** and pick it.
   For a project on a sync server there is no folder to find; the server needs to be set up in
   Settings › Connections first.

The project appears in your list with everything in it. A joined project has no linked folder on
your disk. You can link one later in its settings.

If you already keep Ostler on another PC, you don't need to join each project by hand. Your
projects arrive on this PC on their own through your personal space; see
[Your devices](29-your-devices.md).

### When someone joins as a person you already added

If a new member's name looks like someone you already added to the project, **Sharing** lists them
under **Possible matches**: "Is … the … you added?" Press **Yes, same person** to join them to that
person, so their tasks and changes show under one name. Press **No** if they are someone else.

## Day to day

Ostler sends your changes a few seconds after you make them, and reads other people's changes as
soon as the folder shows them. How fast they arrive depends on your sync app.

- The status bar shows how the open project stands: **Shared · up to date**, **catching up**,
  **can't reach the folder** or **some files couldn't be read**.
- **Sharing** in the project's settings lists the members, says when the project last synced and
  how many changes are waiting, and has **Sync now**.
- The task's activity names the person who made each change.
- When someone assigns you a task on another PC, Ostler tells you **A task was assigned to you**.
  Click the notice to open the task. Ostler also tells you when someone
  [mentions you](03-tasks.md#mentions), changes a task you [follow](03-tasks.md#following) or
  asks for your [sign-off](03-tasks.md#sign-offs).
- **Sharing** lists each person once, with the number of devices they use, and says which one is
  **This PC**.

### When two people change the same thing

- Changes to different fields of a task both stay.
- When two people change the same field, the later change wins.
- If someone else's edit replaces a description you wrote here, your version is kept in the task's
  description history and the activity says so. Open the history to restore it.
- If two people create a task with the same number at the same time, the later one takes the next
  free number. Its activity says which number it had before.
- A task deleted on one PC and edited on another stays deleted, unless the edit came after the
  deletion.

Rules, recurring tasks, reminders and agents run only on the PC where the change was made, so
nothing happens twice.

## Removing someone

As an Owner, press **Remove…** beside a member in **Sharing** and confirm. Removing someone takes
all of their devices out of the project.

If the person has open tasks in the project, the dialog says how many and offers **Give their open
tasks to**: choose someone in the project (it starts on you) or **Nobody**. The tasks move when you
press **Remove**.

- They keep what they already have. No app can take back a copy someone already has.
- Nothing changed from then on reaches them. Ostler moves the project to a new key that only the
  remaining members get.
- The old invite stops working. If someone new joins later, copy a new invite for them.
- Their changes that had already reached you stay. Anything they write after being removed is
  ignored.

If someone removes you, **Sharing** says so. Everything already on your PC stays, but nothing more
is sent or received. Press **Stop sharing on this PC** to keep working on your own copy.

## Stopping sharing on this PC

**Stop sharing on this PC** in **Sharing** keeps the project here with everything it has and stops
sending and receiving. The others keep sharing and keep their own copies. To share it again later,
share it into a new folder.

## Encryption

Everything Ostler writes in the shared folder is encrypted with the project's key, and signed by
the PC that wrote it, so a changed or forged file is refused. The folder's sync provider sees only
encrypted files, their sizes and when they change. The key travels only inside the invite.
[Privacy](18-privacy.md) says more.

## Telling the team in Teams, Slack or Discord

A project can post its news to a channel the team already reads, whether or not the project is
shared. In **Project settings › Sharing › Tell the team**, choose **Add a channel…**, pick where,
and paste the channel's webhook address:

- **Microsoft Teams**: in the channel, choose **Workflows**, then **Post to a channel when a webhook
  request is received**, and copy the address it gives. (Teams' older Office 365 connectors were
  retired in 2026.)
- **Slack**: an app with **Incoming Webhooks** for the channel gives the address.
- **Discord**: the channel's **Settings › Integrations › Webhooks › New Webhook › Copy Webhook URL**.
- **Another service** (Zapier, Make, n8n, Power Automate): any `https` address. Ostler posts JSON
  with the event, the project's id and name, a title, the text and the time.

Choose what to post: **Status updates** (the health and your note), **Milestones done** (the name
and outcome) and **Reviews waiting** (the task's title). Nothing else is sent. **Send a test** posts
a test message at once; each channel says when it last posted and, after a failure, why.

Anyone with a webhook address can post to the channel, so Ostler stores it encrypted with Windows'
protection and shows only its host. A post is one request that waits at most ten seconds and is
never retried, so a broken channel never holds Ostler up. Channels belong to this PC: they are not
shared through the synced folder.

## If something goes wrong

- **Can't reach the folder:** check that the folder is still there and that your sync app is
  running. Ostler tries again on its own.
- **Some files couldn't be read:** usually a file is still syncing. It's read on the next try. If
  the message stays, **Sharing** lists each problem.
- **The invite doesn't work:** copy all of it again. If someone was removed after the invite was
  made, ask a member for a new one.
- **Don't keep Ostler's own data folder in OneDrive, Dropbox or Google Drive.** Share projects
  through a folder of their own instead. Settings › Data warns you if the data folder is in one.
