# Backups and restore

Ostler backs up your data by itself, so a mistake or a broken disk doesn't cost you your plans.

## What is backed up

Every project's plan (tasks, milestones, goals, decisions, comments), the Library, AI drafts and
your settings. Agent workspaces are not included. A backup's saved AI key only works for this
Windows user on this PC.

## When

- Automatically, once a day, keeping the last 7. Change how many to keep, or turn automatic
  backups off, in Settings › Data.
- Before every update that changes how Ostler stores your data.
- Whenever you choose **Back up now**.

Backups you make yourself are never deleted automatically.

## Where

Settings › Data › **Open backups folder** shows them in File Explorer. They live in the
`backups` folder inside Ostler's data folder.

Keep Ostler's data folder itself out of OneDrive, Dropbox and Google Drive: a sync app copying the
database while Ostler has it open can damage it. If the data folder is in one of them, Settings › Data
says so. To keep your backups in a synced folder, use a second place (below) instead.

## Restore

In Settings › Data, choose **Restore** on a backup. Ostler first saves your current data as a new
backup, then restarts and restores the one you chose. If the restore fails, Ostler puts everything
back as it was.

## Keep a copy elsewhere

Backups are on the same computer as your data. When the disk fails or the laptop is lost, they go
with it. To keep a copy somewhere else too:

1. In Settings › Data › Backups, choose **Also copy backups to…** and pick a folder: a USB drive,
   another disk, a network share (`\\server\share`) or a synced folder.
2. From then on, every backup (automatic, **Back up now**, and the one Ostler makes before a restore)
   is also copied to an `Ostler backups` folder inside it. The copy runs in the background, so a slow
   USB drive or share never holds Ostler up.

The second place keeps the same backups as the main folder: the same number of automatic backups,
and the ones you made yourself are kept for good. Ostler only ever removes copies it put there
itself; anything else in that folder is left alone. A copy is assembled under a hidden name and
renamed when it is complete, so a half-finished copy never looks like a backup.

Settings shows when the last copy was made, for example "Last copied: today at 09:12 to
E:\Ostler backups". **Choose another folder…** sends future copies elsewhere, and **Stop copying**
stops them; copies already there stay.

Ostler won't use a folder inside its own data folder (a copy there is lost with the data) or one
Windows reports as read-only. A folder inside OneDrive, Dropbox or Google Drive is fine: Settings
notes that the backups will then be stored by that service too.

### When the folder is missing

If the folder can't be reached (a USB drive unplugged, a share offline, or the drive came back with
a different letter), the backup itself is still made as usual. Ostler says so once in the Inbox,
"Backups could not be copied to E:\Ostler backups", and tries again at the next backup. The Inbox
item goes away by itself when a copy succeeds. If the drive now has a different letter, choose the
folder again.

### Restore from the second place

In Settings › Data › Backups, choose **Restore from the second place…**. Ostler lists the backups
there; **Restore** on one copies it into the backups folder on this computer first, then asks and
restores it exactly as **Restore** does above. On a new computer, choose the same folder with
**Also copy backups to…** first, then restore from it.

You can also export important projects (**More** › **Export project…**).
