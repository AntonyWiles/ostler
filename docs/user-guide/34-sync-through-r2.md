# Sync through your own R2 bucket

Ostler can keep your devices in step through a Cloudflare R2 bucket of your own, instead of Google
Drive or a synced folder. This is **Advanced sync**. Your PCs and your Android phone all read and
write the same bucket. There is still no Ostler account and no Ostler server.

R2 is Cloudflare's file storage. It has a free tier, and one person's use stays well inside it.
See [what Cloudflare R2 costs](29-your-devices.md#advanced-sync-what-cloudflare-r2-costs) for the
numbers.

## How it works now

- **One bucket per person.** Your bucket holds your personal space: your personal data, your
  settings and every project you own. Each person who uses R2 has their own bucket. Nobody else
  gets your bucket's keys.
- **Projects shared with other people** are shared the way they always were: through a OneDrive,
  Dropbox or Google Drive folder, Google Drive with no folder, or a sync server (see
  [Sharing a project](28-sharing-a-project.md)). There is no way to share a project with another
  person through R2 yet, because they would need your bucket's keys.
- **A shared project stays where it is shared.** When you move your space to R2, a project you
  share with others in a different place keeps syncing there. Ostler says how many projects stayed.
- **Your phone gets the projects in your bucket.** A phone that syncs through R2 gets every project
  in your personal space. A team project kept in someone else's Drive folder still needs that
  person's invite, as in [Ostler on your phone](32-ostler-on-your-phone.md).

## 1. Make a bucket

1. Sign in to the Cloudflare dashboard. Make a free account if you don't have one.
2. Open **R2**. The first time, Cloudflare asks you to turn R2 on; it may ask for a payment card
   even for the free tier.
3. Press **Create bucket**. Give it a name in lower case, such as `my-ostler`. Leave the location
   on automatic, unless you want R2's EU jurisdiction.
4. Write down the bucket name, and your **Account ID**. The Account ID is 32 letters and digits,
   shown on the R2 overview page.

Use the bucket only for Ostler. Don't make it public.

## 2. Make an API token for that bucket only

1. In **R2**, open **Manage API tokens** and press **Create API token** (an account token or a user
   token both work).
2. Under **Permissions**, choose **Object Read & Write**.
3. Under the buckets it applies to, choose **Apply to specific buckets only** and pick your
   Ostler bucket. Ostler needs nothing else, so a token that can only touch this bucket is safer.
4. Press **Create API token**.
5. Cloudflare shows an **Access Key ID** and a **Secret Access Key**. Copy both now. Cloudflare
   shows the secret only once. If you lose it, make a new token.

## 3. Set up the first device

Start on whichever device you have to hand. The first device makes your personal space in the
bucket; the others join it.

### On a PC

1. Open **Settings › Devices** and press **Keep my devices in step…**.
2. Choose **My own R2 bucket**.
3. Fill in the **Account ID**, the **Access key ID**, the **Secret access key** and the
   **Bucket** name.
4. Press **Test connection**. Ostler says **The bucket answered** when it can read and write it.
5. Press **Keep them here**. Ostler makes your personal space in the bucket and puts your projects
   in it.

For R2's EU jurisdiction, or another S3-compatible store, set its https address under **Endpoint**
in **Settings › Devices › Advanced sync**.

### On the phone

1. Open **Settings › Advanced sync** and press **Enter bucket details instead**.
2. Type the account ID, the bucket name, the access key ID and the secret.
3. Ostler tests the bucket. When it says **This bucket has no personal space yet**, start it on
   this phone.

### How often to look

Under **Advanced sync** you choose how often a device looks for changes from your other devices,
from every minute to **Only when I press Sync now**. Each look is one small request. A longer gap
uses fewer calls; your own changes still go up soon after you make them.

## 4. Add more devices

Each new device needs the bucket's details, and then your OK, the same as with any other way of
keeping your devices in step.

**With a setup code (easiest).** On a device that already uses the bucket:

- on a PC, open **Settings › Devices › Advanced sync** and press **Make a setup code**;
- on the phone, open **Settings › Advanced sync** and press **Share a setup code**.

Ostler shows a code that starts with `ostler-r2:` and a one-time passphrase. The code is sealed
with the passphrase, so send them separately, for example the code by email and the passphrase read
out. On the new device, open Advanced sync, paste the code under **Use a setup code**, type the
passphrase and press **Use this code** (on the phone, **Use this bucket**).

**By typing the details.** On the new device, type the same account ID, bucket, access key ID and
secret as on the first one. You can use the same token on every device, or make one token per device
so you can cancel one alone later.

**Then join.** On the new device, press **Set up from my other device**. It shows a six-digit
code. On a device you already use, check the code matches and press **Allow**. Having the bucket's
keys is not enough: Ostler doesn't add a device until you allow it.

## Moving from Google Drive or a folder

If your devices already keep in step through Google Drive or a synced folder, you can move to R2
without starting again.

1. On a PC, set up the bucket under **Settings › Devices › Advanced sync** and press **Test
   connection**.
2. Press **Move to R2**, then **Move**. Ostler copies your space and the projects in it into the
   bucket, and shows how many files it has copied.
3. When it's done, Ostler says **Your space is now in your R2 bucket**. Your other devices switch
   the next time they sync.
4. On each other device, set up the same bucket, with a setup code or by typing the details. Until
   it has the bucket, a PC says **Another device moved your space into an R2 bucket**.

The old copy in Drive or the folder is left as it was; nothing is deleted. Delete it yourself once
every device works from the bucket. If the move stops part way, nothing is lost: press **Try again**
and it carries on where it stopped.

To stop, press **Stop using this bucket** on a device. That device forgets the bucket's keys.
Nothing is deleted from the bucket or the device.

## What the messages mean

- **"The bucket refused the keys."** The access key ID or secret is wrong, or the token can't read
  and write this bucket. Check you copied the whole secret, and that the token has **Object Read &
  Write** for this bucket. If in doubt, make a new token.
- **"There's no bucket with that name in this account."** Check the bucket name (lower case) and
  the account ID. A bucket in R2's EU jurisdiction needs its address in **Endpoint**.
- **"Those bucket details don't look right."** The account ID must be 32 characters (0–9, a–f), and
  the bucket name lower case. An endpoint must start with https.
- **"Couldn't reach the bucket."** No network, or the bucket took too long to answer. Sync carries
  on when the connection is back.
- **"The bucket's service had a problem."** Cloudflare had a fault. Ostler tries again at the next
  look.
- **"That isn't a setup code."** Copy the whole code, starting with `ostler-r2:`.
- **"That passphrase doesn't open this code."** Check the passphrase, or make a new code.
- **"This project syncs through an R2 bucket, and this PC has no bucket set up."** Set up the
  bucket under **Settings › Devices › Advanced sync**, then try again.
- **"This bucket already has a personal space."** Another device started it. Use **Set up from my
  other device** to join it.
- **A device alone has used half of a free allowance.** Look for changes less often. See
  [what Cloudflare R2 costs](29-your-devices.md#advanced-sync-what-cloudflare-r2-costs).

## Privacy

- **The bucket is yours.** It is in your own Cloudflare account. Ostler has no server and no copy,
  and never sees your keys.
- **Everything is encrypted before it leaves the device.** Your projects, personal data and
  settings are sealed with your projects' keys, the same as in Drive or a folder. Cloudflare sees
  file names Ostler makes up, their sizes and when they change, but never what is in them.
- **The keys stay on your devices.** On a PC, the bucket's secret is saved in `r2-sync.json` in
  Ostler's data folder, encrypted with the system's own protection for your user account: Windows data
  protection, the macOS Keychain, or the Linux keyring. If the system can't encrypt it, Ostler
  says so and doesn't save it. On the phone, it
  is kept in Android's secure store. It is never shown again, sent anywhere else or written to a
  log.
- **A setup code is sealed.** It can only be opened with its passphrase. Send the two separately.
- **Keys alone don't add a device.** A new device still needs your OK, with its code, on a device
  you already use.
