# Rules

A rule does a small piece of routine work for you when something happens to a task: "when a task
moves to Blocked, if it has the label **urgent**, then set the priority to Critical and notify me."
Rules belong to one project, run on your PC only and never use AI, agents or the network.

## Make a rule

1. Open the project's **Project settings**, choose **Board** and go to **Rules**.
2. Press **New rule**, give it a name and build the sentence:
   - **When**: a task is created; a task moves to a status (optionally from another one); its
     assignee changes; all its subtasks are done; its checklist is complete; or its due date is
     reached.
   - **If** (optional, all must hold): its label, priority, assignee, milestone, status or a custom
     field is, or isn't, a value.
   - **Then**: set the status, priority, assignee or milestone; add or remove a label; add checklist
     items; add a comment; notify me; or archive the task if it is finished.
3. The sentence under the form reads back what the rule will do. Press **Save rule**.

A project can have up to 50 rules.

## Try it first

In the rule form, press **Try it on a task…**, pick a task and press **Try**. Ostler shows which
conditions hold and what the rule would change, without changing anything. The trigger isn't
checked: the task is taken as if it had just happened.

## Turn rules off, edit and delete

Each rule in the list has a switch to turn it off and on, shows how many times it has run, and has
**Edit** and **Delete** buttons. Deleting happens at once; **Undo** in the notice brings the rule
back.

A milestone that a rule moves tasks to can't be deleted until you change or delete that rule.

## How rules run

- A rule runs in the same step as the change that set it off, so **Undo** on that change also
  undoes what the rules did.
- A rule's own changes don't set off other rules.
- The task's activity shows what a rule did, marked "by rule" and the rule's name.
- Due date rules run while Ostler is open, once for each task and due date.
- Rules leave tasks with agent work alone: they don't change the status of, or archive, a task an
  agent is working on.
- Importing tasks, creating a project from a template and the demo projects don't set off rules.
  The advanced demo comes with rules of its own, which act from then on.
- **Notify me** shows a notification and an Inbox item on this PC; nothing is sent anywhere.

The automation API can also list, create, change, switch and delete rules; see the Automation API
documentation.
