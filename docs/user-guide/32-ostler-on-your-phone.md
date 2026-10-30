# Ostler on your phone

Ostler for Android is a small companion to the PC app. It shows your projects, what needs doing
today and each task's details, and lets you change a task from your pocket. Your projects reach it
through your own Google Drive; there is no Ostler account and no Ostler server. The PC stays where
you plan.

Ostler for Android needs Android and a Google account. It is not on every phone's store yet: it is
given to a list of testers through Google Play, so ask the person who runs Ostler to add your
Google account.

## Installing

1. The person who runs Ostler adds your Google account as a tester. Open the link they send you on
   your phone and choose to join the test, then install **Ostler** from Google Play.
2. Open Ostler on the phone.

## Signing in

Open **Settings** on the phone and press **Sign in with Google**. Choose the Google account that
holds your Ostler folder in Google Drive, the same one you connected on your PC. Ostler asks for
access to Google Drive, and uses it only for its own **Ostler** folder.

While Ostler is in Google's testing mode:

- Only Google accounts on the tester list can sign in. Anyone else sees "Access blocked".
- Google shows an **unverified app** screen. Choose **Continue** to go on.
- Your sign-in lasts **7 days**. After that Settings says Google asked you to sign in again; press
  **Sign in with Google** again. Your projects stay on the phone meanwhile, and they catch up once
  you sign in.

**Sign out** in Settings ends the connection.

## Getting your projects onto the phone

There are two ways, and you can use both.

### Pair with your PC

This brings every project you have on your PC to the phone, as it does for another PC (see
[Your devices](29-your-devices.md)).

1. On the PC, open **Settings › Devices** and turn on **Keep my devices in step**, choosing
   **Google Drive**. A space you already keep in a folder is not moved to Drive,
   and the phone can only find one kept in Drive.
2. On the phone, signed in to the same Google account, press **Set up from my other device**, then
   **Start**. A code appears.
3. On the PC, in Settings › Devices, check that the device shows the same code and allow it.
4. The phone says it is now one of your devices. Your projects arrive by themselves, with a count
   of tasks under each.

### Join a team project

A project someone shared with you through Google Drive (see
[Sharing a project](28-sharing-a-project.md)) comes to the phone with its invite.

1. Ask the owner to share it through **Google Drive** and send you the invite, which includes a
   link. Projects shared through a folder on a PC or a sync server cannot be joined from a phone.
2. On the phone, press **Join a project**, paste the invite and press **Join**. Or open the invite's
   link on the phone, and Ostler joins once you are signed in.
3. The project appears under **Shared projects**. **Sync now** checks Drive straight away; Ostler
   otherwise keeps it in step while the app is open.

## What you can do

- **Projects** lists your projects with their open and done counts. Open one to see the figures
  the PC's Overview shows, the next milestone and its tasks grouped by status.
- **My Day** shows today's list in the order you set on the PC.
- **A task** shows its status, priority, dates, who it is assigned to, its milestone, labels,
  description, checklist and comments.
- **Change a task**: its status, its title, who it is assigned to and its due date (quick buttons
  for today, tomorrow, in a week or none, or a date written as `2026-12-31`). Tick checklist items,
  add a comment and add a new task to a project. A new task starts in Backlog with medium priority.

Changes you make go back through Drive to the PC and to everyone else on the project, a few seconds
after you save while you are online. Changes made on the PC reach the phone the same way.

In a project where you have **Can view** access, the phone refuses changes and says you have
view-only access. Your role is set by the project's owners, as on the PC.

## What stays on the PC

The phone is for checking and light changes. These are done on the PC:

- **Marking a repeating task done.** The phone cannot make the next copy of it, so it says a
  repeating task can only be marked done on the PC.
- **Your personal data is read-only on the phone.** Pairing brings your projects across, but your
  personal space itself (My Day order, pins, reminders, goals, settings and connected accounts) is
  changed on the PC only.
- Making, sharing and deleting projects, roles and invites, milestones and goals, the Library's
  files, whiteboards, history and restore, time tracking, rules, agents and Ostler AI.
- Automation rules and reminders do not run on the phone.

## Privacy

Your projects live on the phone, in a database only Ostler can read, and in your own Google Drive,
encrypted. Nothing goes to Ostler's developer: no analytics, no ads, no crash reports. See
[Privacy](18-privacy.md).

## If something is wrong

- **Sign-in says it did not work**: check the account is on the tester list, and that the phone has
  Google Play services.
- **"The folder wasn't found"**: set up sync on the PC first (Settings › Devices, or share a
  project through Google Drive).
- **A project is not up to date**: press **Sync now**. "Cannot reach Google Drive" means the phone
  is offline or signed out.
- **No projects after pairing**: on the PC, check the project is shared or that Keep my devices in
  step is on, then try pairing again.
