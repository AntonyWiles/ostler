# Privacy

Your data stays on your computer unless you choose something that sends it.

## What leaves this computer

Only these, and only once you set them up or use them:

- **Ostler AI** sends what a feature needs to the AI provider you chose, when you use that
  feature. Ostler doesn't include or provide an AI model: Ostler AI is the name for Ostler's AI
  features, and they send your request to the model you connect, either a provider's service with
  your own API key or a model running on this PC. When you use a provider's service, what you send
  is handled under that provider's terms and privacy policy, not Ostler's: Ostler can't see or
  control what happens to it once it's sent. Read your provider's privacy policy before you connect
  it. A model that runs on this PC sends nothing anywhere.
- **Coding agents** run a separate agent program. It sends the task and the files it reads to the
  model provider you set up for it, while it works on a task. OpenCode ships with Ostler, but it is
  an agent program, not a model: it uses the model provider you set up, and what it sends is
  handled under that provider's terms and privacy policy. Setup commands you write for a
  project run on this PC and can reach the internet if you make them.
- **A shared project** is written, encrypted, into the folder you chose to share it through. Your
  sync app (OneDrive, Dropbox, Google Drive or a network share) carries it to the people you gave
  the invite to. A project shared through a **sync server** is written, just as encrypted, to that
  server; it sees file sizes, when they were written and who signed in, never what is in them.
- **A project shared through Google Drive** is written, encrypted, into a folder Ostler makes in your
  Google Drive. Google sees file sizes and when they were written, never what is in them. Ostler only
  reads and writes its own folder there, not the rest of your Drive, and uses it to give the
  people you name access to that folder.
- **Your other PCs.** With **Keep my devices in step** on (Settings › Devices), your personal data,
  settings and projects are written, encrypted, into a folder in your own synced storage, and
  your other PCs read it. Your sync app carries it, and nothing goes through an Ostler server. See
  [Your devices](29-your-devices.md).
- **Ostler for Android.** The phone app signs in with Google and reads and writes only Ostler's own
  folder in your Google Drive, encrypted, to bring your projects to the phone and send changes back.
  It sends nothing to the developer and has no analytics, ads or crash reports. See
  [Ostler on your phone](32-ostler-on-your-phone.md).
- **Calendar links** you subscribe to are fetched from the server in the address you pasted.
- **Connected accounts** (Settings › Connections › Accounts) talk only to that provider: Google,
  Microsoft, Dropbox or the CalDAV server you named. Signing in opens your browser; Ostler then
  reads only what you turned on, such as the calendars you added. If you choose a calendar for
  your time blocks, it writes there each block's task title and project name, and nothing else.
  If you choose a list for your tasks, it writes there the title, project name and due date of the
  open tasks assigned to you.
- **Channels** you add in a project's **Tell the team** (Teams, Slack, Discord or another
  webhook) get that project's name and the news you chose: status updates, milestones done,
  reviews waiting.
- **GitHub** is asked about issues and pull requests you link, refresh or import.
- **Updates** are checked with GitHub when Ostler starts, unless you turn that off in
  Settings › About.
- **Links** and **Report a problem** open in your browser.

Nothing else is sent: no usage data, no crash reports and nothing about you. The details follow.

## In detail

- **No account needed.** Everything lives in Ostler's data folder on this PC, and there is no
  Ostler server. Nothing is shared with other people unless you share a project.
- **Shared projects.** When you share a project ([Sharing a project](28-sharing-a-project.md)),
  Ostler writes the project's tasks, records, Library files and settings, and the people its tasks
  name, into the folder you chose. It never writes the project's folder on your disk, your
  contacts, which person is you, or your settings. Every file is encrypted with the project's key
  (AES-256) and signed by the PC that wrote it. The key travels only inside the invite, so your
  sync provider sees encrypted files, their sizes and when they change, but not what is in them.
  Anyone with the folder and the invite can read the project, and an Editor or Owner can change it.
  Someone you remove keeps what they already had, but nothing written after that, which uses a new
  key.
- **Your devices.** With **Keep my devices in step** on, Ostler writes your own personal data
  (My Day, reminders, goals, contacts, your connected accounts and calendar links), the settings
  that follow you, and each of your projects into your personal folder, encrypted and signed in
  the same way. Only your own PCs can open it: each PC's key is locked to that PC, and a PC is
  added only when you allow it with a code. The secrets in that data, such as an account's sign-in
  token or a calendar link's address, travel encrypted and are sealed again with Windows'
  protection on each PC. Settings that belong to one PC, such as the window layout, the data folder,
  each project's linked folder, and the tokens and ports of the automation API and agents, stay on
  that PC. Your AI conversations, agent work, task copies, search indexes, logs and undo history
  stay on each PC too.
- **What your sync provider can see.** OneDrive, Dropbox or Google Drive can see the names of the
  files and folders Ostler writes, their sizes and when they change. It can't see what is in them.
  Ostler never talks to Google, Microsoft or Dropbox for any of this: it writes files into the
  folder, and your sync app copies them.
- **No tracking.** Ostler sends no usage data and no crash reports. Errors go to a log file on your
  computer, and you decide whether to share it (**Help** › **Copy diagnostics**).
- **Your project folders.** Ostler only reads a linked folder. It writes to one only when you create
  a new project folder with it, or when you apply, undo or restore an agent's work. It saves your
  own edits first, and never pushes anything anywhere.
- **Ostler AI** sends nothing until you set it up and use it. A model that runs on this PC sends
  nothing anywhere. Ostler AI may read everything Ostler holds, including contacts, costs, budgets,
  billable time and rates, calendar events, your own goals and field values, but each request sends
  the provider you chose only what that feature needs:
  - the request's own records (the task, note or comments it works on);
  - the project's Library items set to **Always**, and those set to **When selected** that you
    choose or attach to a task;
  - the files in the project's folder that the feature reads;
  - contacts, costs and the rest only when a feature needs them, such as **Describe it** naming a
    contact.

  A Library item set to **Human only** is never sent. Ostler AI never writes: it suggests, and
  anything saved is your own click.

  What each feature sends: **Write it up** on Home's Since you were last here card sends only task
  titles and counts, when you press it. **Find tasks** (From text or a photo) sends only the text
  in its box, when you press it. If you added a photo, it goes too, scaled down and without its
  location or other details, but only when Settings › AI lets the model read images. **Find
  actions and decisions** sends only that Library note's title and text, when you press it, and
  never a note set to Human only. **Ask Ostler** sends your question and today's date, then your
  question with the records, contacts and file passages Ostler's own search found on this PC (their
  listed fields, cut to a set size), when you press **Ask**. A follow-up question also sends the
  open conversation's earlier questions and answers (text only, the latest five). It never sends a
  Human only Library item or anything from a project that is turned off, and reads no file when
  **Search file contents** is off. **Describe it** in a filter bar sends only your words, today's
  date and the project's names (statuses, priorities, labels, milestones, goals, iterations, people
  and contacts), when you press **Make filter**. No task is sent. **Improve writing** sends only
  the text you chose, the style and the project's name, never from a Library item set to Human
  only. **Summarise** on a task's comments sends that task's title and its comments, with their
  authors' names and dates, when you press it. **Polish with AI** on release notes sends only the
  draft: the milestone's or iteration's name, the finished tasks' titles and the first sentences
  you chose to include, when you press it. **Draft from activity** in a status update sends the
  project's name, its activity since the last status update (or the last two weeks) as the
  activity list words it, with task titles, and its open milestones' names, dates and task counts,
  when you press it. Nothing is posted until you press **Post**. **Fill with AI** on an AI field
  sends, for each task, only the field's name, instruction and option names and that task's title,
  description and checklist, when you press it, and nothing else. It never runs on its own.

- **Words inside your files.** Ostler reads the text of the PDFs, text files and Word, PowerPoint
  and Excel files in your Library on this PC, so search can find it. That text is kept in Ostler's
  data folder and sent nowhere by search. When Ostler AI is set up, it may read a file's text only
  as that item's Ostler AI access allows (documents start as **When selected**), so Word,
  PowerPoint and Excel text can now reach Ostler AI where a file's access lets it.
- **Calendar files you add** (Settings › General › Calendars) are read only when you add them or
  press **Reload**, from where they are; Ostler never copies, changes or uploads them, and follows
  nothing in them, such as a link. Their events are kept in Ostler's data folder, shown beside your
  tasks, and never searched or put in an export or a project file.
- **Calendar links you subscribe to** (Settings › General › Calendars › Subscribe to a calendar
  link…) are the one thing Ostler fetches for your calendars. It fetches exactly the address you
  pasted, from the server in that address (such as outlook.office365.com, calendar.google.com or
  icloud.com), and nothing else: when you add the link, a minute after Ostler starts, every hour
  while it runs, when you show a hidden calendar again, and when you press **Refresh** (or call the
  automation API's refresh). A hidden link calendar isn't fetched every hour. It never fetches more
  often, and nothing is fetched until you add a link. Each request is a plain `GET`
  over `https` with no cookies, no sign-in and no headers but Ostler's name as the `User-Agent` and,
  after the first time, the "only if changed" headers the server gave last time (`If-None-Match`,
  `If-Modified-Since`). Ostler sends nothing about you, your tasks or your PC, and follows at most
  three `https` redirects. The address itself is a secret (anyone with it can read the calendar):
  it is stored encrypted with Windows' protection for your account, never in plain text (if Windows
  can't encrypt, a link can't be saved), never shown again in full, and never written to the log,
  the activity feed, Copy diagnostics or any automation API answer.
- **Snip to task** captures your screen only when you start a snip yourself (its key, the
  notification-area menu or the command palette), and never in the background. The picture stays
  in memory until you press **Add task**, then is saved in the project's Library on this PC, set to
  **When selected** and attached to the task, so the task's agent and Ostler AI can read it like any
  attachment; set it to **Human only** to keep it to yourself. **Cancel** throws it away. Ostler
  uploads it nowhere by itself.
- **Contacts** stay in Ostler's data folder. **Call** and **Email** hand Windows a `tel:` or
  `mailto:` address made from the number or address saved on the contact, and Windows opens the app
  you set for it; Ostler itself calls and sends nothing. **Open website** opens the saved website in
  your browser. Ostler AI may read contacts when a feature needs them (see Ostler AI above).
  Contacts are never in the shareable report or an agent's prompt (unless you write one into a
  task's description), and never written to the log. A project file you export carries the
  contacts its tasks name. A `.vcf` file you import is read once, from
  where it is, and only the cards you choose are kept. See [Contacts](25-contacts.md).
- **Listen** on that card uses a voice installed in Windows. Nothing is sent and no audio is saved.
- **Files you export** (a project file, CSV, PDF, calendar file or web page) hold what you chose
  to put in them, and go wherever you save or send them. Ostler uploads none of them. A calendar
  file is a copy, not a live feed, and a shared web page makes no requests of its own.
  A project file can be protected with a password: the whole file is encrypted, and only someone
  with the password can import it. Ostler never stores, logs or sends the password, and cannot
  recover a lost one.
- **Keys and tokens** (AI keys, the GitHub token, the email server's password, and each project's
  automation token)
  are never shown again after you enter them. They are encrypted with Windows' protection for your
  account when available; otherwise stored in plain text and encrypted on the next start where Windows can.
- **Agents** listen for connections only on this computer, and only while they're on. Each run
  gets its own password, which stops working when the run ends.
- **The automation API**, and so an AI assistant you connect over MCP, listens only on this
  computer, only while you turn it on in Settings › Connections, and only for a project's token.
  An assistant you connect may send what it reads from Ostler to its own AI provider: Ostler does not
  control that. Revoke the project's token to cut it off.
- **Updates.** The installed Ostler asks GitHub whether there is a new version when it starts, and
  downloads it if there is. It sends nothing about you or your data. Turn either off in
  Settings › About. The portable Ostler never checks.
- **GitHub.** Ostler asks `api.github.com` about an issue or pull request only when you open a task
  that links one, press **Refresh**, link one, or read a repository's issues to import. It sends
  the repository and issue number (or the import's filters), your GitHub token if you saved one, and
  the app's name. Nothing is fetched in the background, and nothing is ever written to GitHub.
  Reading a folder's Git remote to suggest its repository happens on this PC. See [GitHub](22-github.md).
- **Email.** Ostler sends email only through the server you set up in Settings › Connections ›
  Email, and only when you press **Email invite** or **Send a test email**. It sends the invite
  message to the address you type, and nothing else. See
  [Sharing a project](28-sharing-a-project.md#email-an-invite).
- **Links** in this guide and **Report a problem** open in your browser. That is the only time
  Ostler opens a web page for you.

## Organisation policy

An organisation can set some of Ostler's choices for every PC it manages, with Intune, Group
Policy or by copying a file. Ostler reads them when it starts, from
`%ProgramData%\Ostler\policy.json` and from the registry under
`HKLM\Software\Policies\Ostler`; where both say something, the registry wins. What the policy
sets shows in Settings as set by your organisation.

- **Apps** (`apps`; registry `GoogleClientId`, `MicrosoftClientId`, `MicrosoftTenant`,
  `DropboxClientId`): the organisation's own app registrations for connecting accounts. With a
  Microsoft tenant, work accounts sign in at the organisation's own Microsoft address.
- **Kinds of account not allowed** (`forbiddenProviders`, such as `["dropbox"]`; registry
  `ForbiddenProviders`, separated by commas): those aren't offered in Settings › Connections and
  can't be connected.
- **Sync server** (`syncServer` with `url`, `signIn` (`key` or `microsoft`) and `scope`; registry
  `SyncServerUrl`, `SyncServerSignIn`, `SyncServerScope`): the server projects can be shared
  through. People still use their own access key or work account.
- **Ostler AI off** (`disableAi`; registry `DisableAi`, a DWORD of 1) and **AI agents off**
  (`disableAgents`; `DisableAgents`). What people had chosen is kept, and comes back if the policy
  goes.

```json
{
  "apps": { "microsoft": { "clientId": "…", "tenant": "contoso.onmicrosoft.com" } },
  "forbiddenProviders": ["dropbox"],
  "syncServer": { "url": "https://sync.contoso.com", "signIn": "key" },
  "disableAi": false,
  "disableAgents": true
}
```

Anything in the policy that isn't well formed is left out, as if it weren't there.
