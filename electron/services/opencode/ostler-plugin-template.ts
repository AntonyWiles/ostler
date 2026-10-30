import { killsProcessesByPattern } from './process-kill-guard'
import {
  PLAN_CONTENT_GUIDANCE,
  PLAN_FIRST_AVAILABLE,
  PLAN_FIRST_GUIDANCE
} from '@shared/plan-first'
import type { WorkspaceSetupRecord } from '@shared/ostler-api'
import { describeWorkspaceSetup } from '@shared/workspace-setup'
import { REVIEW_COMMENTS_GUIDANCE } from '@shared/review-comments'
import { COMMENT_ANSWERS_GUIDANCE } from '@shared/comment-answers'
import { REVIEWER_GUIDANCE, REVIEWER_RUNS_AVAILABLE } from '@shared/reviewer-runs'
import {
  MAX_REPORT_PICTURES,
  MAX_WALKTHROUGH_STOPS,
  REPORT_EXTRAS_GUIDANCE,
  REPORT_PICTURES_FOLDER
} from '@shared/agent-report-extras'
/**
 * Vendored template code for the Ostler OpenCode plugin.
 * This plugin is written into the session slot at `.opencode/plugins/ostler-plugin.js`
 * and loaded automatically by opencode serve via the slot's config.
 *
 * Hooks:
 * 1. `event`: Dispatches session.created/status/idle/error/updated and file.edited
 *    events to the Ostler runner bridge on loopback HTTP.
 * 2. `tool.execute.before`: Defense-in-depth path validation ensuring tool target
 *    arguments stay strictly within the designated workspace slot directory,
 *    and reports the call -- with its arguments -- to the runner bridge. The
 *    one exception is the task's attachments folder (`attachmentsPath`, in
 *    the slot's runtime home): opencode's read-only tools may open it, and
 *    nothing else may touch it.
 * 3. `tool.execute.after`: Reports what the call returned, so the transcript
 *    shows the command and its output rather than just a tool name.
 */
export function generateOstlerPluginJs(
  slotPath: string,
  bridgePort: number,
  bridgeSecret: string,
  sessionId: string,
  projectId: string,
  attachmentsPath: string | null = null
): string {
  // Normalize slot path forward slashes
  const normalizedSlot = slotPath.replace(/\\/g, '/')
  const normalizedAttachments = attachmentsPath ? attachmentsPath.replace(/\\/g, '/') : ''
  return `
import * as path from 'path';

function isWithinSlot(slotPath, targetPath) {
  if (!targetPath || !slotPath) return false;
  const absSlot = path.resolve(slotPath);
  const absTarget = path.resolve(slotPath, targetPath);
  const lowerSlot = absSlot.toLowerCase();
  const lowerTarget = absTarget.toLowerCase();
  if (lowerTarget === lowerSlot) return true;
  const rel = path.relative(absSlot, absTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  const prefix = lowerSlot.endsWith(path.sep) ? lowerSlot : lowerSlot + path.sep;
  return lowerTarget.startsWith(prefix);
}

// Bound to a fixed name: a minified build may rename the function itself.
const killsProcessesByPattern = ${killsProcessesByPattern.toString()};

// opencode's read-only tools: the only ones allowed into the attachments folder.
const READ_ONLY_TOOLS = new Set(['read', 'list', 'glob', 'grep']);

export const OstlerPlugin = async (ctx) => {
  const slotPath = process.env.OSTLER_SLOT_PATH || ${JSON.stringify(normalizedSlot)};
  // Baked in, never read from the environment: the agent cannot widen it.
  const attachmentsPath = ${JSON.stringify(normalizedAttachments)};
  const bridgePort = process.env.OSTLER_BRIDGE_PORT || ${bridgePort};
  const bridgeSecret = process.env.OSTLER_BRIDGE_SECRET || ${JSON.stringify(bridgeSecret)};
  const sessionId = process.env.OSTLER_SESSION_ID || ${JSON.stringify(sessionId)};
  const projectId = process.env.OSTLER_PROJECT_ID || ${JSON.stringify(projectId)};

  function summarizeValue(value, limit) {
    if (value === null || value === undefined) return '';
    let text;
    if (typeof value === 'string') text = value;
    else {
      try {
        text = JSON.stringify(value);
      } catch (e) {
        text = String(value);
      }
    }
    if (typeof text !== 'string') return '';
    return text.length > limit ? text.slice(0, limit) + '… (truncated)' : text;
  }

  function summarizeArgs(args) {
    if (!args || typeof args !== 'object') return {};
    const summary = {};
    for (const key of Object.keys(args)) {
      const value = summarizeValue(args[key], 600);
      if (value) summary[key] = value;
    }
    return summary;
  }

  async function postBridge(endpoint, body) {
    if (!bridgePort) return;
    try {
      await fetch('http://127.0.0.1:' + bridgePort + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + bridgeSecret
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Best-effort callback dispatch
    }
  }

  return {
    event: async ({ event }) => {
      await postBridge('/event', {
        sessionId,
        projectId,
        event
      });
    },
    'tool.execute.before': async (input, output) => {
      const args = output?.args || {};
      const candidates = [
        args.filePath,
        args.path,
        args.file,
        args.directory,
        args.targetPath,
        args.destination,
        args.source
      ].filter((p) => typeof p === 'string' && p.trim().length > 0);

      if (input?.tool === 'bash' && killsProcessesByPattern(args.command)) {
        throw new Error(
          'Ostler guidance: do not stop processes found by name or pattern; that also matches processes outside your workspace, and has killed Ostler itself. Stop only a process you started, by its PID. Anything still running from your workspace is stopped automatically when your session ends.'
        );
      }
      const readOnlyTool = READ_ONLY_TOOLS.has(input?.tool);
      for (const target of candidates) {
        if (
          readOnlyTool &&
          attachmentsPath &&
          isWithinSlot(attachmentsPath, path.resolve(slotPath, target))
        ) {
          continue;
        }
        if (!isWithinSlot(slotPath, target)) {
          await postBridge('/security-violation', {
            sessionId,
            projectId,
            tool: input?.tool,
            targetPath: target,
            reason: 'Path escapes workspace slot directory'
          });
          throw new Error('Ostler defense-in-depth: Tool execution outside workspace slot is blocked (' + target + ')');
        }
      }

      // Record tool call and enforce turn/tool-call cap
      if (bridgePort) {
        try {
          const res = await fetch('http://127.0.0.1:' + bridgePort + '/tool-call', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + bridgeSecret
            },
            body: JSON.stringify({
              sessionId,
              projectId,
              tool: input?.tool,
              args: summarizeArgs(args)
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.blocked) {
              throw new Error('Ostler cost limit: ' + (data.error || 'Turn/tool-call cap reached'));
            }
            // Refusing this one call is the whole point: throwing is the only
            // channel a before-hook has back to the model, and a model stuck
            // repeating an identical call needs to be interrupted and told
            // why, not silently allowed to keep spending the budget.
            if (data.warn) {
              throw new Error('Ostler guidance: ' + data.warn);
            }
            // Plan first (N9.3a): a file-editing tool before the plan is approved.
            if (data.refused) {
              throw new Error('Ostler plan first: ' + data.refused);
            }
            // A review run (N9.5a): a file-editing tool, refused.
            if (data.reviewRefused) {
              throw new Error('Ostler review run: ' + data.reviewRefused);
            }
          }
        } catch (e) {
          if (
            e.message &&
            (e.message.startsWith('Ostler cost limit:') ||
              e.message.startsWith('Ostler guidance:') ||
              e.message.startsWith('Ostler plan first:') ||
              e.message.startsWith('Ostler review run:'))
          ) {
            throw e;
          }
        }
      }
    },
    'tool.execute.after': async (input, output) => {
      await postBridge('/tool-result', {
        sessionId,
        projectId,
        tool: input?.tool,
        title: summarizeValue(output?.title, 300),
        output: summarizeValue(output?.output ?? output?.result ?? output?.metadata, 2000)
      });
    }
  };
};

export default OstlerPlugin;
`
}

/**
 * Vendored template code for the custom question tool.
 * Written into the slot's opencode config dir at `config/opencode/tool/ostler_ask_question.ts`.
 */
export function generateOstlerAskQuestionToolTs(
  bridgePort: number,
  bridgeSecret: string,
  sessionId: string,
  projectId: string
): string {
  return `
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Ask the human a question and wait for their answer. Use ONLY for a decision a human must make (ambiguous or conflicting requirements, a choice with consequences beyond this task) -- never for anything you could determine by reading the code, since this blocks your turn while a human is found. If nobody answers in time you will be told to proceed on your own judgment.",
  args: {
    question: {
      type: "string",
      description: "The question to ask the human user."
    }
  },
  async execute(args, context) {
    const bridgePort = process.env.OSTLER_BRIDGE_PORT || ${bridgePort};
    const bridgeSecret = process.env.OSTLER_BRIDGE_SECRET || ${JSON.stringify(bridgeSecret)};
    const sessionId = process.env.OSTLER_SESSION_ID || ${JSON.stringify(sessionId)};
    const projectId = process.env.OSTLER_PROJECT_ID || ${JSON.stringify(projectId)};

    if (!bridgePort) {
      return "Error: Question bridge is not available.";
    }

    try {
      const res = await fetch("http://127.0.0.1:" + bridgePort + "/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + bridgeSecret
        },
        body: JSON.stringify({
          sessionId,
          projectId,
          question: args.question
        })
      });

      if (!res.ok) {
        return "Error asking question: HTTP " + res.status;
      }

      const body = (await res.json());
      return "Human answered: " + (body.answer ?? "(no answer provided)");
    } catch (error) {
      return "Error communicating with question bridge: " + (error instanceof Error ? error.message : String(error));
    }
  }
});
`
}

/**
 * Vendored template for the plan-first tool (N9.3a), written into the slot's
 * tool folder only while plans are available. The bridge holds the call while
 * the person decides and answers with the decision, or, when the wait runs
 * out first, with word to call again with the same plan: a plan never
 * proceeds without the person.
 */
export function generateOstlerSubmitPlanToolTs(
  bridgePort: number,
  bridgeSecret: string,
  sessionId: string,
  projectId: string
): string {
  return `
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: ${JSON.stringify(
    `Send your plan for a plan-first task and wait for the person to decide. Call it before you change anything. ${PLAN_CONTENT_GUIDANCE} The answer says whether the plan was approved (carry on), needs changes (revise it and call this again), or the task was cancelled (stop). If it says the plan still awaits approval, call this again with the same plan.`
  )},
  args: {
    steps: { type: "array", items: { type: "string" }, description: "The steps, in the order you will do them." },
    files: { type: "array", items: { type: "string" }, description: "The files you expect to change, relative to the project." },
    risks: { type: "string", description: "What could go wrong, what you are unsure of, anything the person should know before approving." }
  },
  async execute(args) {
    const bridgePort = process.env.OSTLER_BRIDGE_PORT || ${bridgePort};
    const bridgeSecret = process.env.OSTLER_BRIDGE_SECRET || ${JSON.stringify(bridgeSecret)};
    const sessionId = process.env.OSTLER_SESSION_ID || ${JSON.stringify(sessionId)};
    const projectId = process.env.OSTLER_PROJECT_ID || ${JSON.stringify(projectId)};
    try {
      const res = await fetch("http://127.0.0.1:" + bridgePort + "/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + bridgeSecret },
        body: JSON.stringify({ sessionId, projectId, steps: args.steps, files: args.files, risks: args.risks })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return "Error sending the plan: " + (body.error || ("HTTP " + res.status));
      return body.message || "Error sending the plan: no answer";
    } catch (error) {
      return "Error sending the plan: " + (error instanceof Error ? error.message : String(error));
    }
  }
});
`
}

/** Vendored template for the agent's required structured completion report. */
/**
 * Anything quoted inside a generated file goes through JSON.stringify rather
 * than being hand-quoted in the template literal. `\"` inside a template
 * literal is consumed by the template literal itself, so the escape never
 * reaches the file: the emitted tool had bare double quotes inside a
 * double-quoted string, which is a syntax error. opencode then failed to load
 * the session's tools and answered every first message with HTTP 500 --
 * "UnknownError", no detail -- so every embedded agent died before it could do
 * anything.
 */
export function generateOstlerCompleteTaskToolTs(
  bridgePort: number,
  bridgeSecret: string,
  sessionId: string,
  projectId: string
): string {
  return `
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "REQUIRED final action of every session. Submit your completion report after your work is committed. Ostler has no other way to learn you finished -- going quiet is recorded as an unfinished session, not a completed one. Call this even if the task failed or could not be done, and put the reason in the blockers field.",
  args: {
    summary: { type: "string", description: "Concise summary of the completed work." },
    filesChanged: { type: "array", items: { type: "string" }, description: "Relative project files changed; use an empty list for no code changes." },
    verification: { type: "string", description: ${JSON.stringify(
      'What you did to check the work (tests, build, manual reasoning), or "Not run" with the reason. Do not claim verification you did not perform.'
    )} },
    blockers: { type: "string", description: ${JSON.stringify(
      'Remaining blocker, unfinished work, or assumption a human should revisit. Use exactly "None" only if there is genuinely nothing outstanding.'
    )} },
    pictures: { type: "array", items: { type: "object", properties: { path: { type: "string" }, caption: { type: "string" } }, required: ["path"] }, description: ${JSON.stringify(
      `Optional; an empty list when there are none. ${REPORT_EXTRAS_GUIDANCE.pictures}`
    )} },
    walkthrough: { type: "array", items: { type: "object", properties: { path: { type: "string" }, startLine: { type: "number" }, endLine: { type: "number" }, note: { type: "string" } }, required: ["path", "startLine", "endLine", "note"] }, description: ${JSON.stringify(
      `Optional; an empty list when there is none. ${REPORT_EXTRAS_GUIDANCE.walkthrough}`
    )} },
    commentAnswers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["done", "not-done"] }, note: { type: "string" }, path: { type: "string" }, startLine: { type: "number" }, endLine: { type: "number" } }, required: ["id", "status", "note"] }, description: ${JSON.stringify(
      `Optional; an empty list when your task was not sent back with line comments. ${COMMENT_ANSWERS_GUIDANCE}`
    )} },
    tryCommand: { type: "string", description: ${JSON.stringify(
      `Optional; an empty string when there is none. ${REPORT_EXTRAS_GUIDANCE.tryCommand}`
    )} }${REVIEWER_RUNS_AVAILABLE ? FINDINGS_ARG : ''}
  },
  async execute(args) {
    const bridgePort = process.env.OSTLER_BRIDGE_PORT || ${bridgePort};
    const bridgeSecret = process.env.OSTLER_BRIDGE_SECRET || ${JSON.stringify(bridgeSecret)};
    const sessionId = process.env.OSTLER_SESSION_ID || ${JSON.stringify(sessionId)};
    const projectId = process.env.OSTLER_PROJECT_ID || ${JSON.stringify(projectId)};
    try {
      const res = await fetch("http://127.0.0.1:" + bridgePort + "/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + bridgeSecret },
        body: JSON.stringify({ sessionId, projectId, summary: args.summary, filesChanged: args.filesChanged, verification: args.verification, blockers: args.blockers, pictures: args.pictures, walkthrough: args.walkthrough, commentAnswers: args.commentAnswers, tryCommand: args.tryCommand${REVIEWER_RUNS_AVAILABLE ? ', findings: args.findings' : ''} })
      });
      if (!res.ok) return "Error submitting completion report: HTTP " + res.status;
      return "Ostler completion report submitted.";
    } catch (error) {
      return "Error submitting completion report: " + (error instanceof Error ? error.message : String(error));
    }
  }
});
`
}

/** `ostler_complete_task`'s findings argument (N9.5a), there only while reviewer runs are available. */
const FINDINGS_ARG = `,
    findings: { type: "array", items: { type: "object", properties: { file: { type: "string" }, side: { type: "string", enum: ["new", "old"] }, firstLine: { type: "number" }, lastLine: { type: "number" }, comment: { type: "string" }, severity: { type: "string", enum: ["must-fix", "should-fix", "nit"] } }, required: ["file", "side", "firstLine", "lastLine", "comment", "severity"] }, description: ${JSON.stringify(
      'Only in a review run; an empty list otherwise, and when there is nothing to fix. Each finding is on the file and lines of the change it is about, with a severity.'
    )} }`

/** The standing instructions' section on review runs (N9.5a), there only while they are available. */
const REVIEW_RUN_SECTION = `
## Review runs

When your opening message says this is a review run, you review another
agent's change instead of making one. ${REVIEWER_GUIDANCE}

- Ostler refuses file-editing tools in a review run with "Ostler review run".
- Send your findings in \`ostler_complete_task\`'s \`findings\`, with an empty
  \`filesChanged\`.
`

/** The standing instructions' section on plans (N9.3a), there only while plans are available. */
const PLAN_FIRST_SECTION = `
## Plan first

When your opening message says the task asks for a plan first, call
\`ostler_submit_plan\` before you change anything. ${PLAN_FIRST_GUIDANCE}

${PLAN_CONTENT_GUIDANCE}

- Until the plan is approved, Ostler refuses file-editing tools with
  "Ostler plan first". Read, search and run read-only commands as you need.
- When the tool says the plan still awaits approval, call it again with the
  same plan. That is waiting, not repeating yourself.
- When the plan is approved, Ostler checks your workspace and records anything
  changed before approval for the person to see.
`

/**
 * The embedded agent's standing operating instructions, written into the slot
 * and referenced by `instructions` in the slot's `opencode.json` so opencode
 * loads it into the session's system prompt.
 *
 * This is where the *durable* contract lives -- workspace boundary, commit
 * discipline, what "done" means, what to do when blocked. That
 * belongs in the harness rather than accreting into each task's prompt, and a
 * file the model re-reads every turn holds up far better with a weak model than
 * a few lines it saw once at the start of a long session.
 */
export function generateOstlerAgentInstructionsMd(
  slotPath: string,
  baseBranch: string,
  baseCommit: string,
  setup?: WorkspaceSetupRecord
): string {
  // Normalized outside the template: a replace() whose pattern contains a
  // backslash is the one thing that cannot survive being written inline here.
  const normalizedSlot = slotPath.replace(/\\/g, '/')
  return `# Ostler embedded agent — operating instructions

You are an AI agent running inside an Ostler-managed embedded session. Ostler is
watching this session: it records every tool call, tracks the files you touch,
and decides whether your work is accepted. These instructions apply to every
turn, not just the first.

## Your workspace

Your working directory is an isolated Git worktree on your own throwaway branch:

    ${normalizedSlot}

It was forked from \`${baseBranch}\` at \`${baseCommit}\`. Everything you need to do
happens inside it.

- **Never read or write outside this directory.** Ostler blocks it at the tool
  layer and records the attempt as a security violation. There is no reason to
  try: the human's own checkout is deliberately unavailable to you, and it may
  be newer than your baseline.
- The branch is **yours and disposable**. Nothing you commit reaches anyone's
  checkout until a human reviews and merges it, so committing is cheap and
  carries no risk. Commit freely and often.

## Dependencies

${describeWorkspaceSetup(setup) ?? 'No setup ran for this workspace.'}

If the task needs a new or changed dependency, add it with the project's package
manager so its lockfile updates, and commit the lockfile.

Never change the project's scripts or config to work around a broken environment
(for example, by adding an install step to a build script). Report it with
\`ostler_complete_task\` under \`blockers\`.

## Committing is not optional

**Uncommitted changes are never merged.** Ostler refuses to merge a workspace
with a dirty tree, so work you leave uncommitted is work you threw away.

- Commit as you go, and always commit before you stop.
- If you are unsure whether something is worth committing, commit it. A human
  reviews every commit before it lands.

## What "done" means

A task is done when **all** of these are true:

1. The change the task asked for exists in this workspace.
2. It is committed to your branch.
3. You have called \`ostler_complete_task\` with your summary, the files you
   changed, what verification you did (or why none), and any remaining blockers.

Step 3 is the only way Ostler learns you finished. **Going quiet is not
finishing.** If you stop without calling \`ostler_complete_task\`, Ostler records
the session as unfinished, and will message you to continue — so call it.

Call it even when the outcome is bad: if the task cannot be completed, call
\`ostler_complete_task\` anyway and put the reason in \`blockers\`. A reported
failure is a useful result; silence is not.

## Pictures, a walkthrough and a try command

All three are optional parts of \`ostler_complete_task\`, shown to the person when
they review your work:

- **pictures**: when your change is something a person can see, take
  screenshots of it and save them in \`${REPORT_PICTURES_FOLDER}/\` in your workspace
  (Ostler keeps that folder out of your changes). Up to ${MAX_REPORT_PICTURES} PNG, JPEG, GIF or
  WebP files of 5 MB at most, each a path and an optional caption.
- **walkthrough**: when your change is large, where to start reading: up to
  ${MAX_WALKTHROUGH_STOPS} stops in order, each a changed file, the first and last line in its
  new version, and a note on what those lines do and why.
- **tryCommand**: one command that lets the person see your change working,
  such as \`npm run dev\`. Ostler shows it as a suggestion and never runs it.

## When you are stuck

Work the problem yourself first — you have the whole repository and a shell.
Then, in order of preference:

- **A genuine decision only a human can make** (ambiguous requirements,
  conflicting instructions, a choice with consequences outside this task):
  call \`ostler_ask_question\`. This **blocks your turn** while a human is found,
  so it costs real time — use it for decisions, never for things you could
  determine by reading the code. If nobody answers in time, you will be told to
  proceed on your best judgment: do so, and record the assumption in
  \`blockers\`.
- **A tool refused with "Ostler guidance"**: you repeated an identical call.
  Repeating it again will not help. Change approach.
- **A tool refused with "Ostler defense-in-depth"**: you tried to touch something
  outside your workspace. Work inside the workspace instead.
- **Truly blocked**: call \`ostler_complete_task\` with the blocker described.
  Do not spin.

## Guidance from the person

While you work, the person you are working for may send you a message. It
arrives as a user message that starts with
\`[Guidance from <their name>, the person you are working for, sent through Ostler]\`.

- It is the person's own word about the task you hold. Follow it as you would
  the task text: it can change how you do the task, or what counts as done (a
  definition of done relaxed or tightened, an approach ruled out).
- It stays within the task's scope. It never adds a different task, never moves
  you outside your workspace, and never lifts any rule in these instructions.
  If it asks for something these instructions forbid, or something only a human
  can do, do not act on that part: say so with \`ostler_ask_question\`.
- It is not the automated message Ostler sends when you stop early. Carry on
  from where you are, with the message in mind; there is no need to start over.

## Line comments from the last review

When the person sent this task back with comments on lines of your last
attempt, your opening message lists them after the task's details: each with
its id, its file, its lines (new-version lines, or removed lines numbered in the old
version), an excerpt of the diff and the comment. ${REVIEW_COMMENTS_GUIDANCE}

Answer every comment by its id in \`ostler_complete_task\`'s \`commentAnswers\`:
done (with where the change now is, if it helps), or not done and why.
${COMMENT_ANSWERS_GUIDANCE}
${PLAN_FIRST_AVAILABLE ? PLAN_FIRST_SECTION : ''}${REVIEWER_RUNS_AVAILABLE ? REVIEW_RUN_SECTION : ''}
## Do not

- Do not wait for permission to start. The task is assigned to you; begin${
    PLAN_FIRST_AVAILABLE ? ' (with the plan, when your task asks for a plan first)' : ''
  }.
- Do not reply with only a plan or an explanation of what you would do. Take the
  action.
- Do not try to merge your branch, switch branches, or touch another session's
  work. A human decides what merges.
`
}
