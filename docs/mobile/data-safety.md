# Play Console: Data safety answers

Answers for the Data safety form (Play Console › your app › App content › Data safety), question by
question, for Ostler for Android. They come from the same facts as the
[privacy policy](privacy-policy.md): data stays on the device and in the person's own Google Drive,
encrypted; nothing is sent to the developer; no analytics, no ads, no telemetry. Play's wording
changes now and then, so read each question before you answer, and change an answer if the app
changes.

The key idea: Play counts data as **collected** only when it leaves the device to you or to someone
acting for you. Ostler sends nothing to the developer, and the only place data goes is the person's
own Google Drive, which is the person's own storage and not an Ostler server. Where you can choose
between "collected" and "shared" for that, answer as below, and keep the explanation under "Notes".

## Data collection and security

| Question                                                              | Answer                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does your app collect or share any of the required user data types?   | **No**. Nothing is sent to the developer or to any server the developer runs. Project data goes only to the person's own Google Drive, encrypted, at their request.                         |
| Is all of the user data collected by your app encrypted in transit?   | **Yes**. Google Drive and Google sign-in are reached over HTTPS only.                                                                                                                       |
| Do you provide a way for users to request that their data is deleted? | **Yes**. The person deletes projects in the app, deletes the Ostler folder in their Google Drive and uninstalls the app. The developer holds no data to delete. The privacy policy says so. |

If the console insists that signing in with Google counts as collecting data, use the answers in the
next section; they are the most that applies.

## Data types, only if the console makes you list them

Answer **No** for every type not listed here. For the ones listed, choose:

| Data type                     | Collected | Shared | Why it is on the form                                                                                | Optional or required            |
| ----------------------------- | --------- | ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| Personal info › Email address | Yes       | No     | Sign in with Google shows which account is connected. It stays on the phone and goes to Google only. | Required for the app's features |
| App activity / Files and docs | Yes       | No     | The person's projects and tasks, written encrypted to their own Google Drive.                        | Required for the app's features |

For each, set:

- **Processed ephemerally:** No (the data is kept on the phone and in the person's Drive).
- **Purpose:** App functionality. Nothing else: not analytics, not advertising, not personalisation,
  not fraud prevention.
- **Data is collected for sharing with third parties:** No.

## Other questions you may meet

| Question                                                                | Answer                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Does the app contain ads?                                               | No.                                                                                               |
| Does the app use an advertising ID?                                     | No.                                                                                               |
| Does the app use analytics or crash reporting?                          | No. Ostler has no telemetry; errors go to a log file on the device.                               |
| Does the app use location, contacts, photos, microphone, camera or SMS? | No. The phone app asks for no permission beyond internet access.                                  |
| Is the app designed for children?                                       | No.                                                                                               |
| Privacy policy address                                                  | https://antonywiles.github.io/ostler/privacy/, built from [privacy-policy.md](privacy-policy.md). |

## Notes to keep with the form

- The app uses the Google Drive scope (`drive`) and the signed-in email only. The `drive` scope is
  used only on Ostler's own folder in the person's My Drive.
- Ostler is in Google's testing mode: only listed test users can sign in, and their sign-in expires
  after 7 days. This is not part of the Data safety form, but reviewers may ask.
- If you ever add analytics, crash reporting, ads or a server of your own, every answer above
  changes and the privacy policy must change first.
