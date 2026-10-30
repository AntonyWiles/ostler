# Your devices

Ostler can keep your own PCs in step. Your projects, your personal data and your settings are the
same on every PC you set up, so a task you change at home is there at work, and a reminder you set
on one PC is there on the others. There is no Ostler account and no server. The PCs share a folder
you already keep in sync through OneDrive, Google Drive or Dropbox, or any other folder your PCs
share, such as one on a network drive. Each PC keeps its own copy.

## Turning it on

Open **Settings › Devices** and press **Keep my devices in step…**. Ostler lists the OneDrive,
Google Drive and Dropbox folders it finds on this PC and asks where to keep your devices in step.
Choose one, or **Another folder…** to pick any folder yourself, then press **Keep them here**.
Ostler creates an **Ostler** folder there, such as **Dropbox › Ostler**. If it finds none of the
three, it goes straight to choosing a folder. Nothing else is needed on this PC until you add
another one.

**Google Drive, with no folder on this PC.** When a Google account with Google Drive access is
connected (Settings › Connections), the choices include **Google Drive**. Ostler then keeps the
**Ostler** folder in your My Drive and nothing is saved on this PC, so it works even when Google
Drive for desktop is not installed. On your other PC, connect the same Google account and press
**Set up from my other device**: Ostler finds the space in your Drive and shows the same code on
both screens. A space you already keep in a folder stays where it is; it is not moved to Drive.

**Your phone.** An Android phone can join the same space when it is kept in Google Drive; see
[Ostler on your phone](32-ostler-on-your-phone.md).

The section lists **Your PCs**, with **This PC** marked. The first PC is the one that made the
folder. The others join it as described below.

## What travels and what stays

**Travels to your other PCs:**

- your personal data: My Day, pins, reminders, your inbox state, personal goals and their
  check-ins, weekly reviews, days off, shopping lists, your contacts and which contacts a task is
  linked to, the calendars you added, and the calendar and task list you chose for your time blocks
  and your tasks;
- your connected accounts and calendar links, so you sign in once;
- every project, through its shared copy (see [Sharing a project](28-sharing-a-project.md));
- your settings, except the ones that belong to one PC.

**Stays on each PC:**

- the window layout and the data folder;
- each project's linked folder on your disk;
- the tokens, ports and settings of the automation API, AI agents and the backup's second place;
- the Windows settings that start Ostler at sign-in, the tray icon and the Quick add shortcut;
- your AI conversations, agent work and task copies, search indexes, logs, and the undo history.

Your choice of calendar for time blocks and of list for **My tasks** travels to your other PCs. The
copies themselves are made by the PC that runs that copying, and each PC keeps its own record of
what it has copied.

## Setting up a new PC

Install Ostler on the new PC, and the same sync app as your other PC. On the first screen, choose
**Set up from my other device**.

Ostler looks for your **Ostler** folder in OneDrive, Google Drive and Dropbox on this PC, and says
where it found it. Press **Set up from my other device**. If it's somewhere else, such as a
different folder or a network drive, or it found the wrong one, press **Choose the folder…** and
pick the **Ostler** folder, or any folder it's inside.

1. The new PC shows a six-digit code.
2. On a PC that already keeps your devices, open **Settings › Devices**. A notice says that a new
   device wants to join. Check that it shows the same code, then press **Allow**. Ostler also
   shows a notification for it.
3. The new PC says **Getting your projects…**. When its first copy has arrived, it opens on Home
   with your projects, personal data and settings.

If you press **Not now**, the request is set aside and the PC isn't added. Ostler doesn't add a PC
until you press **Allow** on a PC you already use.

Changes from another PC arrive when the folder syncs, and how soon depends on your sync app. Your
personal data (My Day and the rest) from another PC shows here after you restart Ostler. Projects
and settings update as they arrive.

## Removing a device

In **Settings › Devices**, press **Remove…** beside a PC and confirm. The PC stops getting your
projects, personal data and settings, and nothing you change from then on reaches it. Ostler
moves your personal folder and each project to a new key that only your remaining PCs get.

Removing a PC doesn't delete anything, on it or anywhere else. It keeps what it already has, and
it can still read what it had before you removed it. It can't read anything written after. Ostler
can't reach into that PC, so if you no longer use it, sign out of your accounts there and remove
Ostler's data from it yourself.

## If something goes wrong

- **The new PC waits at the code.** Check that the other PC is on, that Ostler is open there and
  that the code matches.
- **Ostler can't find your folder on the new PC.** Check that your sync app is signed in on this PC
  and has finished syncing the **Ostler** folder. In Dropbox and OneDrive, a folder kept online only
  still works, as it downloads when Ostler reads it. In Google Drive, a folder someone shared with
  you needs a shortcut in **My Drive**. Then press **Choose the folder…** and pick it.
- **"There's no Ostler space in that folder".** The folder you picked has no Ostler folder inside it
  yet. It may still be syncing from your other PC: wait, then choose it again.
- **"That space was made by a newer version".** Update Ostler on this PC first.
- **A PC is missing from the list.** Its request may still be waiting. It shows under pending
  requests until you allow or refuse it.
- **Projects haven't arrived.** A project from your other PC waits until its folder reaches this PC
  through your sync app. Ostler lists it as **A project from your other devices is waiting for its
  folder to arrive on this PC** in **Sharing**, and checks again on its own.
- **Don't keep Ostler's own data folder in OneDrive, Dropbox or Google Drive.** Use the personal
  folder for the synced copy instead. Settings › Data warns you if the data folder is in one.
