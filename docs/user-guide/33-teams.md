# Teams and the Team view

A team is a named group of people from your address book, such as a design team or a site crew,
with a lead you pick. The **Team** view shows what needs attention for each person across all your
projects, so a team leader can see who is overdue, blocked or away without opening every project.

Teams belong to you alone. They give nobody any access, they are not shared with the people in a
project, and they follow you to your own other PCs. To control what people can do in a shared
project, use [roles](28-sharing-a-project.md#roles).

## Making a team

1. Open **Settings › People**. Under **Teams**, press **New team…**.
2. Give it a **Name**, such as "Design".
3. Choose a **Lead**, or leave **No lead**.
4. Under **People in the team**, tick the people. If the list is empty, add people to your address
   book first.
5. Press **Add team**.

Each team shows how many people it has and who leads it. **Edit** changes it. **Archive** puts it
away (**Restore** brings it back; **Show archived teams** lists them), and **Delete** removes the
team after asking. Deleting a team never deletes the people in it. Archive and delete can be undone.

## The Team view

Open **Team** from the sidebar or the command palette (`Ctrl+K`, then type "Team"). It lists one row
per person.

- **Team** limits the list to one team; **All people** shows everyone.
- **Project** limits the counts to one project; **All projects** counts them all.
- **Workload** opens the [Workload](05-home-and-inbox.md#workload) view with the same choices. The
  Workload header has a **Team** link back.

Click a column heading to sort by it; click it again to reverse. Click a person's row to open their
open tasks, grouped by project. Each task is a link that opens it.

### Reading the columns

- **Open:** the person's tasks that are not done, archived or deleted (tasks still in triage are left out).
- **Overdue:** open tasks whose due date has passed.
- **Due this week:** open tasks due between Monday and Sunday of this week.
- **Blocked:** open tasks with an open blocker.
- **Stalled:** tasks that have been started (past Ready) and have not changed for seven days.
- **Hours this week:** the time logged this week, beside the person's capacity, such as "12 h of
  40 h". With no capacity set it shows the hours alone.
- **Away:** the days off coming up in the next two weeks, such as "Away 3 Nov–7 Nov", or "Not away".
  It includes bank holidays and the away days other people in a shared project have chosen to
  [show](28-sharing-a-project.md#showing-when-you-are-away).
- **Last active:** when the person last changed a task or wrote a comment. "No activity" means
  nothing yet.
- **Sign-off:** how many [sign-offs](03-tasks.md#sign-offs) are waiting for that person to answer.

If no one is listed, the view says **No one to show**; make a team, or add people, in
**Settings › People**.

The Team view reads what is on this PC, so for people in shared projects it is only as fresh as the
last sync.

## Filtering Workload by team

In [Workload](05-home-and-inbox.md#workload), **Team** limits the rows to one team, and **All
people** shows everyone. The choice stays in the address, so a link to Workload keeps it.
