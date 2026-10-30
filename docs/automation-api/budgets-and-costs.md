# Budgets and costs

A project's budget and its costs, as the app's Costs view, the Overview's Budget card and a task's
Costs section use them. Base path: `<baseUrl>/automation/<projectId>`.

Every amount is a whole number of **minor units** of the project's currency: pence for GBP, cents
for EUR and USD, yen for JPY (no decimals), fils for KWD (three decimals). `12345` in GBP is
£123.45. Sums are exact. Every amount is in the project's one currency: Ostler never converts.

A cost:

```json
{
  "id": "…",
  "projectId": "…",
  "date": "2026-11-02",
  "amount": 12000,
  "description": "Venue deposit",
  "category": "Venue",
  "workItemId": "…",
  "milestoneId": null,
  "state": "planned",
  "createdAt": 1792400000000,
  "updatedAt": 1792400000000
}
```

- `date` is `YYYY-MM-DD`: when it was paid, or when it will be.
- `description` is required, at most 200 characters. `category` is free text, at most 60; empty
  is no category.
- `workItemId` and `milestoneId` are optional and must be this project's. Deleting the task or
  milestone keeps the cost and clears the link.
- `state` is `planned` or `paid`.

The [shopping list](#shopping-list) at the end of this page makes paid costs when its items are
bought.

## Budget

| Route         | What it does                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /budget` | `{ projectId, amount, currency, summary }`. `amount` is null with no budget; `currency` is an ISO 4217 code (the person's region's until one is chosen). `summary` is what the Budget card shows (below).                |
| `PUT /budget` | Sets `{ amount?, currency? }`; a field left out keeps its value, `amount: null` removes the budget (costs stay). Changing the currency relabels every amount and converts nothing. A bad amount or currency is HTTP 400. |

`summary`: `paid`, `planned`, `total` (paid plus planned), `left` (budget minus total, null without a
budget; negative when over), `over` (how far over, or 0), `byCategory`
(`[{ category, paid, planned, total }]`, largest first) and `byMilestone`
(`{ milestoneId: { paid, planned, total } }`).

## Costs

| Route                   | What it does                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /costs`            | The project's costs by date. `?category=` (exact; empty for no category), `?state=planned\|paid`, `?workItemId=`, `?milestoneId=`. `?format=csv` returns the CSV the app's Export costs to CSV writes instead. |
| `GET /costs/:costId`    | One cost of this project. An unknown id, or another project's, is HTTP 400.                                                                                                                                    |
| `POST /costs`           | Adds a cost. Body: `{ date, amount, description, category?, workItemId?, milestoneId?, state? }` (`state` defaults to `planned`).                                                                              |
| `PATCH /costs/:costId`  | Changes the fields given. Mark as paid is `{ "state": "paid" }`, with `date` and `amount` when the payment differs from the plan.                                                                              |
| `DELETE /costs/:costId` | Deletes a cost and returns it.                                                                                                                                                                                 |

The CSV is UTF-8 with a BOM, RFC 4180 quoting and CRLF line ends: Date, Description, Category, Task,
Milestone, State, Amount (a plain number with a dot, such as `120.00`), Currency.

```http
POST /automation/<projectId>/costs
{ "date": "2026-11-02", "amount": 12000, "description": "Venue deposit", "category": "Venue" }

PATCH /automation/<projectId>/costs/<costId>
{ "state": "paid", "date": "2026-11-04", "amount": 11500 }
```

The budget and costs travel in the project file (`budget`, `costs`); a template carries the budget
and planned costs only, dated relative to the day it is used.

## Shopping list

What the project needs bought, as the app's Shopping list shows it. An item:

```json
{
  "id": "…",
  "projectId": "…",
  "name": "Wall plugs",
  "quantity": 3,
  "unit": "packs",
  "estimate": 450,
  "contactId": "…",
  "supplierName": "Jones Hardware",
  "workItemId": null,
  "orderKey": "V",
  "costId": null,
  "boughtOn": null,
  "pricePaid": null,
  "createdAt": 1792400000000,
  "updatedAt": 1792400000000
}
```

- `name` is required, at most 200 characters. `quantity` is a number more than 0 (it may have
  decimals: 2.5 m) and defaults to 1. `unit` is free text, at most 20; empty for none.
- `estimate` is for the whole line, in minor units, or `null`.
- `contactId` is the supplier, a [contact](contacts.md); `workItemId` must be this project's task.
  Deleting either keeps the item and clears the link.
- `costId` is the paid cost buying the item made, or `null` while it is still to buy. `boughtOn`
  and `pricePaid` are that cost's `date` and `amount`: the cost is the one record of the purchase,
  so the budget's summary counts it and never the item. Change the price paid on the cost.
- `GET /budget`'s `summary.stillToBuy` is the unbought items' estimates, kept apart from `planned`,
  `total` and `left`.

| Method   | Path                       | What it does                                                                         |
| -------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/shopping`                | The list in its order, bought items too.                                             |
| `POST`   | `/shopping`                | Add an item, at the end unless `afterId` (`null` for first) or `beforeId` places it. |
| `PATCH`  | `/shopping/:itemId`        | Change the fields given; `afterId` or `beforeId` moves it.                           |
| `DELETE` | `/shopping/:itemId`        | Delete an item. A bought item's paid cost stays.                                     |
| `POST`   | `/shopping/:itemId/bought` | Tick it as bought: `{ "pricePaid": 425, "date": "2026-10-18" }`.                     |
| `DELETE` | `/shopping/:itemId/bought` | Untick it: deletes the paid cost it made.                                            |

`POST /shopping/:itemId/bought` makes, in one transaction, a paid cost with `pricePaid` as its
amount, `date`, the item's name as its description, the category "Shopping" and the item's task,
and points the item at it; it returns `{ item, cost }`. An item already bought is HTTP 400.
`DELETE /shopping/:itemId/bought` returns the item and the deleted cost. Deleting the cost through
`DELETE /costs/:costId` unticks the item too.
