# Automation API: Contacts

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Contacts

Contacts are the people a project involves who do no work in it: a client, a plumber, a supplier.
Like people they are shared by every project, so any project's automation token reads and changes
the same list. They are not people: no task is assigned to them and they are not in Workload.

| Method | Path                   | Body                                                                           | Response                                                                                                                                        |
| ------ | ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/contacts`            | —                                                                              | Array of `{ id, name, organisation, role, phones, emails, website, address, notes, createdAt, updatedAt }`, sorted by name. `?q=` filters them. |
| POST   | `/contacts`            | `{ name, organisation?, role?, phones?, emails?, website?, address?, notes? }` | The new contact.                                                                                                                                |
| PATCH  | `/contacts/:contactId` | Any of the `POST` fields                                                       | The contact. Fields left out keep their values.                                                                                                 |
| DELETE | `/contacts/:contactId` | —                                                                              | `{ contact, links }`: the contact and the task links that went with it.                                                                         |

- `phones` is a list of `{ label, number }` (up to 10); `label` is free text such as `"Mobile"` or
  `""`. Numbers are kept as written.
- `emails` is a list of addresses (up to 10); each must be a plain email address.
- `website` is an `http` or `https` address; one without a scheme gets `https://`.
- `?q=` keeps contacts whose name, organisation, role, emails or phone numbers hold every word.
- `PATCH` with `phones` or `emails` replaces the whole list.
- Deleting a contact takes it off every task that names it, in every project.

## A task's contacts

For the token's project's tasks only.

| Method | Path                                       | Body                  | Response                                                                                                     |
| ------ | ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/work-items/:workItemId/contacts`         | —                     | Array of `{ id, projectId, workItemId, contactId, role, createdAt, contact }`, in the order they were named. |
| POST   | `/work-items/:workItemId/contacts`         | `{ contactId, role }` | The new link, with its `contact`.                                                                            |
| DELETE | `/work-items/:workItemId/contacts/:linkId` | —                     | The link that was removed. The contact itself stays.                                                         |

- `role` is `"asked-for-it"`, `"supplier"` or `"other"`. A task names a contact once per role, and
  at most 20 contacts in all.
- To find tasks by contact, use `GET /work-items?filter=` with the `contact` field
  ([filtering](filtering-search-saved-views.md)).
- The project-scoped `GET /search` never returns contacts.
