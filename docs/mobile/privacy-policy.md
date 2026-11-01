# Ostler privacy policy

This policy covers Ostler, the project manager for Windows, and Ostler for Android, its phone
companion. It was last updated on 30 October 2026.

Ostler is made by Antony Wiles, who is the developer and the person responsible for the app. Ostler
is free and open source (GPL-3.0). The source code is at https://github.com/AntonyWiles/ostler.
Questions about this policy go to https://github.com/AntonyWiles/ostler/issues.

## The short version

- Your projects and tasks stay on your own devices and in your own Google Drive.
- Everything Ostler puts in Google Drive is encrypted first.
- Nothing is sent to the developer. There is no Ostler server, no account with us, no analytics, no
  advertising and no crash reporting.

## What Ostler for Android stores on your phone

- Your projects, tasks, comments and the other things you see in the app, in a database private to
  the app on your phone. Other apps cannot read it.
- The names and colours of the projects you have joined, and the keys Ostler needs to open them,
  kept in Android's secure storage for the app.
- Which Google account you signed in with. Google keeps your sign-in token itself; Ostler asks
  Google for a short-lived access token each time it needs one and does not keep a copy.

Signing out in the app's Settings ends the connection. Uninstalling the app removes everything it
stored on the phone. Your data in Google Drive stays until you delete it there.

## What Ostler does with your Google account

Ostler uses Sign in with Google so it can reach your own Google Drive. It reads and writes files in
a folder named Ostler in your My Drive. On the PC it can also read the name of a Drive file you link
to. It does not look at your other files, and it does not copy your Google data anywhere except between your own devices, through
that folder.

Ostler asks for these Google permissions (scopes), only when you use the feature that needs them:

| Permission                                         | Where     | Why                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your email address and sign-in (`openid`, `email`) | PC, phone | To show which account is connected.                                                                                                                                                                                                                          |
| Google Drive (`drive`)                             | PC, phone | To keep the Ostler folder in your Drive, put your encrypted projects in it, read what your other devices put there, and let you give other people access to a project's folder. Google calls this a restricted scope; Ostler uses it only on its own folder. |
| Drive files you pick (`drive.file`)                | PC only   | To show the current name of a Google Drive file you link to from the Library. Only the name is read; the file is never downloaded or copied.                                                                                                                 |
| Calendar (`calendar.readonly`, `calendar.events`)  | PC only   | To show your calendars next to your plans and, if you choose a calendar for time blocks, to write each block's task title and project name there.                                                                                                            |
| Contacts (`contacts.readonly`)                     | PC only   | To let you link people from your Google contacts to tasks. Contacts stay on the PC.                                                                                                                                                                          |
| Google Tasks (`tasks`)                             | PC only   | To keep the task list you choose in step with your Ostler tasks.                                                                                                                                                                                             |

The PC app asks for the file, calendar, contacts and tasks permissions only if you connect those
features. The phone app asks for Drive only.

Ostler's use of information received from Google APIs follows the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including its Limited Use requirements. Ostler uses Google data only to give you the features above.
It does not transfer it to anyone else, does not use it for advertising and does not let anyone
read it. People do not read your data: there are no servers for them to read it on.

## Who can see your data

- **Google**, because your encrypted project files are in your Drive. Google can see file names,
  sizes and when they changed. It cannot read what is inside them.
- **People you give access to.** If you share a project through Google Drive, the people you name get
  access to that project's folder, and the invite you send them carries the key to open it. Anyone
  with both can read the project, so treat an invite like a password.
- **Nobody else.** Not the developer, not an Ostler server (there is none), not an advertiser.

## What we collect

Nothing. The developer receives no data from the app: no usage statistics, no device identifiers,
no location, no contacts, no files and no crash reports. Ostler has no telemetry. If something goes
wrong, errors are written to a log file on your own device and you decide whether to share it.

## Other services you choose

Ostler talks to another service only when you set it up: an AI provider you choose for Ostler AI, a
calendar link you paste, a Microsoft or Dropbox account, a CalDAV server, a sync server you share a project through, or GitHub. The phone app
uses none of these. Each of those services has its own privacy policy, and Ostler sends it only what
that feature needs.

## Keeping and deleting your data

Your data belongs to you and lives on your devices and in your Drive. To delete it: remove the
projects in Ostler, delete the Ostler folder in your Google Drive, and uninstall the app. You can
also remove Ostler's access in your Google Account under Security › Third-party apps and services.

## Children

Ostler is not made for children under 13 and does not knowingly collect anything from them.

## Changes

If this policy changes, the new text replaces this page and the date at the top changes. Changes that
affect what Ostler does with your data are also listed in the CHANGELOG at
https://github.com/AntonyWiles/ostler/blob/main/CHANGELOG.md.
