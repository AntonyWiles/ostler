# Contacts

Contacts are the people your projects involve who don't do the work in them: the client, the
plumber, the venue, the supplier of the flowers. Ostler keeps them in one list shared by every
project, lets a task name who asked for it and who supplies it, and opens a call or an email in one
click. Contacts are not [people](05-home-and-inbox.md#workload): no task is assigned to them and
they are not in Workload.

## The Contacts list

Open **Contacts** from the sidebar's More, the command palette (**Ctrl+K**, then type
"contacts"), the **All contacts** link in a task's Contacts section, or a contact found in Search.

- The list on the left is sorted by name. **Search contacts** keeps those whose name,
  organisation, role, emails or phone numbers hold every word you type.
- Choose a contact to see it on the right: its details, **Call** (one button per phone number),
  **Email** (one per address), **Open website**, and the tasks that name it in any project, with
  the project and the role. Choose a task to open it.
- **New contact** asks for a name (the only thing a contact needs), then an organisation, a role
  (their job, such as Site manager), phone numbers each with a label (Mobile, Work), email
  addresses, a website, an address and notes.
- **Edit** changes any of it; **Undo** in the notice puts it back.
- **Delete** asks first and says how many tasks name the contact. Deleting takes it off those tasks
  too; **Undo** brings the contact and its tasks' links back.

## Calling and emailing

**Call** and **Email** hand Windows a `tel:` or `mailto:` address made from the number or address
saved on the contact, and Windows opens whatever app you set for phone calls or email (Phone Link,
Teams, Outlook, Mail). A phone number is kept as you typed it; the call gets only its digits and a
leading `+`. **Open website** opens the contact's website in your browser (`http` and `https`
only). Ostler never makes a call or sends an email itself.

## Contacts on tasks

A task's drawer has a **Contacts** section, under Costs.

1. Press **Add a contact** and type a name: choose a contact, or **New contact "…"** to make one
   from what you typed (fill in the rest later in Contacts).
2. Choose its role: **Asked for it**, **Supplier** or **Other**, and press **Add**.

Each contact shows its role and organisation with **Call** and **Email** buttons, and its name
opens it in Contacts. **Remove** takes it off the task (with **Undo**); the contact itself stays. A
task names a contact once for each role, and up to 20 contacts in all.

A card shows a small contact mark when its task names someone. To find the tasks that name
someone, add a **Contact** filter (in the filter bar's **Add filter**): it holds the tasks that
name, or don't name, the contacts you choose, in any role or in one.

## Importing contacts from a vCard file

Phones, Outlook, Google Contacts and most address books can save contacts as a `.vcf` (vCard) file.

1. In Contacts, press **Import contacts…** and choose the file.
2. Ostler shows every card it read. Untick the ones you don't want. A card whose email matches a
   contact you already have is offered as an update of that contact, which keeps what you have and
   adds what it lacks (new numbers and addresses, an empty organisation filled in); choose **Add as
   a new contact** instead if it is someone else.
3. Press **Import**. Nothing is saved until then.

Ostler reads the name, organisation, job title, phone numbers, emails, website, address and note
from vCard 2.1, 3.0 and 4.0 files, and ignores photos and everything else. A card with neither a
name nor an email is left out. A file can be up to 5 MB and 5,000 cards.

## Importing contacts from a connected account

If you connected a Google, Microsoft 365, Outlook.com or iCloud account in **Settings ›
Connections › Accounts** with **Contacts** turned on, Contacts has **Import from an account…**.
It reads the account's contacts and shows them in the same preview as a vCard file: untick the
ones you don't want, choose update or new for the ones whose email matches, then **Import**. With
more than one account, pick the account at the top.

The import is one way and happens only when you press the button: Ostler never changes anything in
the account, and a contact you edit here stays as you left it. Import again later to pick up new
contacts; the ones you already have are offered as updates.

## Contacts in search and project files

- **Search** finds contacts by name, organisation, role, email, phone number and notes, in their
  own group.
- A **project file** you export carries the contacts its tasks name, and which task names whom.
  Importing it matches each contact by email (or by name when it has no email) and adds the ones
  you don't have. A template carries no contacts.

## Privacy

Contacts stay on this PC, in Ostler's data folder. Ostler AI may read them when a feature needs
them: **Describe it** is given your contacts' names, and **Ask Ostler** can find a contact and send
its details. They are not in the shareable report or in agents' prompts (unless you write a contact
into a task's description yourself), and are not written to Ostler's log. Importing from an
account asks only that provider for the contacts, when you press the button. See
[Privacy](18-privacy.md).
