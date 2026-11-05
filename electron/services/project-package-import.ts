/** Writing a package's records into a new project, in the transaction its caller opens (P5.8). */

import { v4 as uuidv4 } from 'uuid'
import type {
  PlanningActor,
  PlanningFieldDefinition,
  PlanningFieldValue,
  PlanningFieldValues,
  PlanningFieldValuesInput,
  PlanningFieldFills,
  PinKind
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { MAX_GITHUB_LINKS_PER_TASK } from '@shared/ostler-api'
import { parseGithubReference } from '@shared/github/github-reference'
import {
  PACKAGE_TEXT_KINDS,
  packageCreationOrder,
  resolvePackageDate,
  type PackageDate,
  type ProjectPackage,
  viewFromPackage,
  type ViewRefKind
} from '@shared/project-package'
import { packageDependencyLink } from '@shared/project-package'
import { rewriteItemLinkUrl, type ItemLinkIdMaps } from '@shared/item-links'
import { WHITEBOARD_LIMITS, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { remapWhiteboardIds } from '@shared/whiteboard/file-format'
import { taskTypeByName } from '@shared/task-types'
import type { PlanningService } from './planning-service'
import type { TaskTemplateBody } from '@shared/ostler-api'
import { LibraryRepository } from './database/library-repository'
import { WhiteboardService } from './whiteboard-service'
import { ImportBatchRepository } from './database/import-batch-repository'
import { PersonMatcher } from './person-matcher'
import { insertLibraryTextItem } from './library-service'
import { swapRuleRefs, swapTriggerColumn } from '@shared/planning/rule-refs'
import type { CreateFromPackageOptions, PendingWhiteboardPicture } from './project-package-service'

/** Writes every record of the package; returns the ids of the people it created. */
export function writePackageRecords(
  planning: PlanningService,
  projectId: string,
  pkg: ProjectPackage,
  actor: PlanningActor,
  today: string,
  importBatch?: CreateFromPackageOptions['importBatch'],
  /** Time entries come with an exported project, never with a template (R2.3). */
  withTimeEntries = true,
  /** Agents are on and the new project has a folder: Ready and In review stay (D34). */
  agentsLocked = false,
  /** A demo: its people are the project's own, and leave with it. */
  ownPeople = false,
  /** Filled with the whiteboards' image objects whose pictures the importer adds later. */
  pendingPictures: PendingWhiteboardPicture[] = []
): string[] {
  const day = (value: PackageDate | null) => resolvePackageDate(value, today)
  const batches = new ImportBatchRepository(planning.database)
  if (importBatch) {
    batches.insert({
      id: importBatch.id,
      projectId,
      source: importBatch.source,
      fileName: importBatch.fileName,
      createdAt: Date.now(),
      itemCount: 0,
      undoneAt: null
    })
  }

  // People are matched to existing people by exact name, else created. A demo's are its own.
  const people = new PersonMatcher(planning.database, false, projectId, ownPeople)
  const personIds = new Map<string, string>()
  for (const person of pkg.people) {
    personIds.set(person.ref, people.resolve(person.name, person.initials, person.color))
  }

  const goalIds = new Map<string, string>()
  for (const goal of pkg.goals) {
    // A measure's dates count from the day the file is used, as other dates do (N5.6a).
    const measure = goal.measure
      ? {
          ...goal.measure,
          startDate: day(goal.measure.startDate)!,
          targetDate: day(goal.measure.targetDate)!
        }
      : null
    const created = planning.createGoal(projectId, {
      title: goal.title,
      outcome: goal.outcome,
      measure
    })
    if (goal.status !== 'active') planning.updateGoal(created.id, { status: goal.status })
    goalIds.set(goal.ref, created.id)
    // Check-ins come with an exported project, never with a template.
    if (withTimeEntries && goal.checkIns && goal.checkIns.length > 0) {
      planning.goalCheckIns.importCheckIns(
        created.id,
        goal.checkIns.map((checkIn) => ({
          date: checkIn.date,
          value: checkIn.value,
          note: checkIn.note,
          recordedAt: Date.parse(checkIn.recordedAt)
        }))
      )
    }
  }

  // Workstreams, in the file's order, before the milestones and tasks in them.
  const subprojectIds = new Map<string, string>()
  for (const subproject of pkg.subprojects ?? []) {
    const created = planning.subprojects.create(projectId, {
      name: subproject.name,
      description: subproject.description,
      color: subproject.color,
      icon: subproject.icon ?? null,
      leadId: subproject.leadRef ? (personIds.get(subproject.leadRef) ?? null) : null,
      memberIds: subproject.memberRefs.flatMap((ref) => personIds.get(ref) ?? []),
      status: subproject.status
    })
    subprojectIds.set(subproject.ref, created.id)
  }
  const subprojectOf = (ref: string | undefined): string | null =>
    ref ? (subprojectIds.get(ref) ?? null) : null

  const milestoneIds = new Map<string, string>()
  for (const milestone of pkg.milestones) {
    const created = planning.createMilestone(projectId, {
      goalId: milestone.goalRef ? goalIds.get(milestone.goalRef)! : null,
      subprojectId: subprojectOf(milestone.subprojectRef),
      name: milestone.name,
      outcome: milestone.outcome,
      targetDate: day(milestone.targetDate),
      successCriteria: milestone.successCriteria
    })
    if (milestone.status !== 'planned')
      planning.updateMilestone(created.id, { status: milestone.status })
    milestoneIds.set(milestone.ref, created.id)
  }
  // Rounds (N5.7a): each schedule, with its next start counted from today in
  // a template, and the round each was made from.
  for (const milestone of pkg.milestones) {
    if (!milestone.repeat && !milestone.roundStart && !milestone.previousRoundRef) continue
    const nextStart = milestone.repeat ? day(milestone.repeat.nextStart) : null
    const previousRoundId = milestone.previousRoundRef
      ? (milestoneIds.get(milestone.previousRoundRef) ?? null)
      : null
    const id = milestoneIds.get(milestone.ref)!
    planning.rounds.importRound(id, {
      repeat: milestone.repeat && nextStart ? { ...milestone.repeat, nextStart } : null,
      previousRoundId: previousRoundId === id ? null : previousRoundId,
      roundStart: milestone.roundStart ? day(milestone.roundStart) : null
    })
  }

  // Iterations (R6.1). One that overlaps an iteration the project has already
  // is left out, and its tasks join none.
  const iterationIds = new Map<string, string>()
  for (const iteration of pkg.iterations ?? []) {
    const startDate = day(iteration.startDate)
    const endDate = day(iteration.endDate)
    if (!startDate || !endDate) continue
    try {
      const created = planning.iterations.importIteration(projectId, {
        name: iteration.name,
        startDate,
        endDate,
        goal: iteration.goal,
        status: iteration.status,
        summary: iteration.summary ? { ...iteration.summary, carriedToIterationId: null } : null
      })
      iterationIds.set(iteration.ref, created.id)
    } catch {
      // Overlap or a second active one: the project's own iterations win.
    }
  }

  // Task types (N2.7a): one named like a type the project has already is
  // reused; past the project's limit, its tasks come in with none.
  const typeIds = new Map<string, string>()
  /** Types this file made, by ref: only these take the file's fields and template (N2.7b). */
  const madeTypes = new Map<string, string>()
  for (const type of pkg.taskTypes ?? []) {
    const existing = taskTypeByName(planning.taskTypes.list(projectId), type.name)
    try {
      const id =
        existing?.id ??
        planning.taskTypes.create(projectId, {
          name: type.name,
          icon: type.icon,
          color: type.color
        }).id
      typeIds.set(type.ref, id)
      if (!existing) madeTypes.set(type.ref, id)
    } catch {
      // Over the limit: the project's own types win.
    }
  }

  // Custom fields (R2.2): a field named like one the project has already is reused.
  const fieldIds = new Map<string, PlanningFieldDefinition>()
  const optionIds = new Map<string, string>()
  const existingFields = planning.listFields(projectId)
  for (const field of pkg.fields ?? []) {
    const created =
      existingFields.find(
        (candidate) =>
          candidate.name.toLowerCase() === field.name.toLowerCase() && candidate.type === field.type
      ) ??
      planning.createField(projectId, {
        name: field.name,
        type: field.type,
        options: field.options.map((option) => ({
          name: option.name,
          ...(option.color ? { color: option.color } : {})
        })),
        ...(field.aiInstruction ? { aiInstruction: field.aiInstruction } : {})
      })
    fieldIds.set(field.ref, created)
    for (const option of field.options) {
      const match = created.options.find(
        (candidate) => candidate.name.toLowerCase() === option.name.toLowerCase()
      )
      if (match) optionIds.set(`${field.ref}/${option.ref}`, match.id)
    }
  }
  const fieldValuesOf = (task: ProjectPackage['tasks'][number]): PlanningFieldValuesInput => {
    const values: PlanningFieldValuesInput = {}
    for (const [fieldRef, value] of Object.entries(task.fieldValues ?? {})) {
      const field = fieldIds.get(fieldRef)
      if (!field) continue
      const option = (ref: string) => optionIds.get(`${fieldRef}/${ref}`)
      if (field.type === 'choice') {
        const id = option(String(value))
        if (id) values[field.id] = id
      } else if (field.type === 'choices') {
        const ids = (value as string[]).flatMap((ref) => option(ref) ?? [])
        if (ids.length > 0) values[field.id] = ids
      } else if (field.type === 'date') {
        const resolved = day(String(value))
        if (resolved) values[field.id] = resolved
      } else values[field.id] = value as PlanningFieldValue
    }
    return values
  }

  // The project's own columns (MOP-26), before the tasks in them.
  const fileColumns = pkg.columns?.custom ?? []
  const columnIds = new Map<string, { id: string; countsAs: string }>()
  planning.columns.bringIn(projectId, fileColumns).forEach((id, index) => {
    if (id) columnIds.set(fileColumns[index].ref, { id, countsAs: fileColumns[index].countsAs })
  })
  const columnOf = (task: ProjectPackage['tasks'][number]): string | null => {
    const column = task.columnRef ? columnIds.get(task.columnRef) : undefined
    return column && column.countsAs === task.status ? column.id : null
  }

  // Every ref a task names exists before the task: parents and dependencies first.
  const taskIds = new Map<string, string>()
  for (const task of packageCreationOrder(pkg.tasks)) {
    const item = planning.createWorkItem(
      projectId,
      {
        title: task.title,
        description: task.description,
        status: task.status,
        columnId: columnOf(task),
        priority: task.priority,
        labels: task.labels,
        acceptanceCriteria: task.checklist.map((entry) => entry.text),
        dependencyLinks: task.dependsOnRefs.map((ref) => ({
          id: taskIds.get(ref)!,
          ...packageDependencyLink(task, ref)
        })),
        targetDate: day(task.dueDate),
        startDate: day(task.startDate),
        showFrom: task.showFrom === undefined ? null : day(task.showFrom),
        someday: task.someday === true,
        blockedReason: task.blockedReason ?? '',
        impact: task.impact ?? null,
        effort: task.effort ?? null,
        assigneeId: task.assigneeRef ? personIds.get(task.assigneeRef)! : null,
        estimate: task.estimate,
        milestoneId: task.milestoneRef ? milestoneIds.get(task.milestoneRef)! : null,
        parentWorkItemId: task.parentRef ? taskIds.get(task.parentRef)! : null,
        iterationId: task.iterationRef ? (iterationIds.get(task.iterationRef) ?? null) : null,
        typeId: task.typeRef ? (typeIds.get(task.typeRef) ?? null) : null,
        subprojectId: subprojectOf(task.subprojectRef),
        fieldValues: fieldValuesOf(task)
      },
      actor,
      importBatch ? 'imported' : 'human',
      importBatch?.id ?? null,
      // A project file's tasks keep their numbers (N9.8a); a template's start afresh.
      { number: withTimeEntries ? task.number : null }
    )
    taskIds.set(task.ref, item.id)
    // Values Ostler AI filled (N8.4) stay marked as its, with the text they came from.
    const aiFills: PlanningFieldFills = {}
    for (const [fieldRef, fill] of Object.entries(task.aiFills ?? {})) {
      const field = fieldIds.get(fieldRef)
      if (field) aiFills[field.id] = { filledBy: 'ostler-ai', sourceHash: fill.sourceHash }
    }
    if (Object.keys(aiFills).length > 0) planning.markFieldFills(item.id, aiFills)
    for (const entry of task.checklist) {
      if (entry.checked) planning.setChecklistItemChecked(item.id, entry.text, true, actor)
      // An item's date and person (N2.2); a person left out of the file is dropped.
      const dueDate = entry.dueDate === undefined ? null : day(entry.dueDate)
      const assigneeId = entry.assigneeRef ? (personIds.get(entry.assigneeRef) ?? null) : null
      if (dueDate !== null || assigneeId !== null)
        planning.setChecklistItemDetails(item.id, entry.text, { dueDate, assigneeId }, actor)
    }
    // Closed before its repeat is set, so it makes no next occurrence here.
    if (task.resolution === 'wont-do')
      planning.closeWorkItemsAsWontDo([item.id], task.resolutionReason ?? '', actor)
    if (task.recurrence) {
      // Take turns (N2.3): people by ref, as the assignee travels.
      const rotation = (task.recurrence.rotationRefs ?? []).map((ref) => personIds.get(ref)!)
      planning.setRecurrence(
        item.id,
        {
          rule: task.recurrence.rule,
          endsOn: day(task.recurrence.endsOn),
          remaining: task.recurrence.remaining,
          ...(rotation.length > 0 ? { rotation, nextIndex: task.recurrence.nextIndex ?? 0 } : {}),
          ...(task.recurrence.goToAgents ? { goToAgents: true } : {})
        },
        actor
      )
    }
  }

  // The task of the earlier round each copy came from (N5.7a).
  for (const task of pkg.tasks)
    if (task.roundSourceRef && task.roundSourceRef !== task.ref)
      planning.rounds.importRoundSource(taskIds.get(task.ref)!, taskIds.get(task.roundSourceRef)!)

  // Made parents and dependencies first; shown in the order the file lists them.
  planning.keepListedOrder(
    projectId,
    pkg.tasks.map((task) => taskIds.get(task.ref)!)
  )

  for (const label of pkg.labels) planning.setLabelColor(projectId, label.name, label.color)

  const decisionIds: string[] = []
  for (const decision of pkg.decisions) {
    const created = planning.createDecision(projectId, {
      title: decision.title,
      context: decision.context,
      decision: decision.decision,
      alternativesConsidered: decision.alternatives,
      consequences: decision.consequences,
      date: day(decision.date) ?? undefined,
      linkedWorkItemIds: decision.taskRefs.map((ref) => taskIds.get(ref)!)
    })
    decisionIds.push(created.id)
  }

  for (const comment of pkg.comments) {
    planning.addComment(
      taskIds.get(comment.taskRef)!,
      comment.body,
      comment.authorRef ? { kind: 'human', personId: personIds.get(comment.authorRef)! } : actor
    )
  }

  // Billings (N6.4) come with an exported project, never with a template,
  // before the time entries that name them.
  const billingIds = new Map<string, string>()
  if (withTimeEntries && pkg.billings && pkg.billings.length > 0) {
    const ids = planning.billing.importBillings(
      projectId,
      pkg.billings.map((billing) => ({
        from: billing.from,
        to: billing.to,
        markedAt: Date.parse(billing.markedAt),
        entryCount: billing.entryCount,
        billableSeconds: billing.billableSeconds,
        hourlyRate: billing.hourlyRate,
        amount: billing.amount,
        currency: billing.currency
      }))
    )
    pkg.billings.forEach((billing, index) => billingIds.set(billing.ref, ids[index]))
  }

  // Time entries (R2.3) come with an exported project, never with a template.
  if (withTimeEntries && pkg.timeEntries && pkg.timeEntries.length > 0) {
    const now = Date.now()
    planning.time.importEntries(
      projectId,
      pkg.timeEntries.map((entry) => ({
        id: uuidv4(),
        projectId,
        workItemId: taskIds.get(entry.taskRef)!,
        workItemTitle: '',
        personId: entry.personRef ? (personIds.get(entry.personRef) ?? null) : null,
        startedAt: Date.parse(entry.startedAt),
        durationSeconds: entry.durationSeconds,
        note: entry.note,
        source: entry.source,
        billable: entry.billable === true,
        billingId: entry.billingRef ? (billingIds.get(entry.billingRef) ?? null) : null,
        createdAt: now,
        updatedAt: now
      }))
    )
  }

  // GitHub links (R4.4) come with an exported project, never with a template,
  // and without a cache: titles and states are fetched when someone opens the task.
  if (withTimeEntries && pkg.githubLinks && pkg.githubLinks.length > 0) {
    const seen = new Set<string>()
    for (const link of pkg.githubLinks) {
      const reference = parseGithubReference(link.url, null)
      const workItemId = taskIds.get(link.taskRef)!
      const key =
        `${workItemId} ${reference.owner}/${reference.repo}#${reference.number}`.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (planning.githubLinks.listForWorkItem(workItemId).length >= MAX_GITHUB_LINKS_PER_TASK)
        continue
      planning.githubLinks.add(projectId, workItemId, reference)
    }
  }

  // Links between tasks (N2.4) come with an exported project, never with a
  // template; the parser has already dropped any to a task not in the file.
  if (withTimeEntries && pkg.taskLinks)
    for (const link of pkg.taskLinks)
      planning.addWorkItemLink(
        taskIds.get(link.fromRef)!,
        taskIds.get(link.toRef)!,
        link.kind,
        actor
      )

  // The Board's columns (R2.4), after the tasks: a column a task landed in stays shown.
  if (pkg.columns)
    planning.columns.adopt(
      projectId,
      { names: pkg.columns.names, hidden: pkg.columns.hidden },
      { agentsLocked }
    )

  // Rules (R6.2) come with an exported project, never with a template. One
  // naming a person, milestone or field the file doesn't carry is left out.
  if (withTimeEntries && pkg.rules && pkg.rules.length > 0) {
    for (const rule of pkg.rules) {
      const column = (ref: string) => columnIds.get(ref)?.id
      const swapped = swapRuleRefs(rule, {
        person: (ref) => personIds.get(ref),
        milestone: (ref) => milestoneIds.get(ref),
        column,
        field: (ref, value) => {
          const field = fieldIds.get(ref)
          if (!field) return undefined
          const option = (optionRef: string) => optionIds.get(`${ref}/${optionRef}`)
          if (field.type === 'choice') {
            const id = option(String(value))
            return id ? { fieldId: field.id, value: id } : undefined
          }
          if (field.type === 'choices' && Array.isArray(value)) {
            const ids = value.map((entry) => option(String(entry)))
            return ids.every((id) => id !== undefined)
              ? { fieldId: field.id, value: ids as string[] }
              : undefined
          }
          return { fieldId: field.id, value }
        }
      })
      if (!swapped) continue
      try {
        planning.rules.create(projectId, {
          ...rule,
          trigger: swapTriggerColumn(rule.trigger, column),
          ...swapped
        })
      } catch {
        // A rule the project can't take (its limit, say) is left out like a missing ref.
      }
    }
  }

  const templateIds = new Map<string, string>()
  // The project's own task templates (N2.1), through the one task template
  // store. Their field values stay relative; one the project can't take is
  // left out like a rule that names a missing ref.
  for (const saved of pkg.taskTemplates ?? []) {
    const fieldValues: PlanningFieldValues = {}
    for (const [fieldRef, value] of Object.entries(saved.fieldValues ?? {})) {
      const field = fieldIds.get(fieldRef)
      if (!field) continue
      const option = (ref: string) => optionIds.get(`${fieldRef}/${ref}`)
      if (field.type === 'choice') {
        const id = option(String(value))
        if (id) fieldValues[field.id] = id
      } else if (field.type === 'choices') {
        const ids = (value as string[]).flatMap((ref) => option(ref) ?? [])
        if (ids.length > 0) fieldValues[field.id] = ids
      } else fieldValues[field.id] = value as PlanningFieldValue
    }
    try {
      const made = planning.taskTemplates.save({
        name: saved.name,
        projectId,
        body: {
          ...saved.body,
          assigneeId: saved.assigneeRef ? (personIds.get(saved.assigneeRef) ?? null) : null,
          ...withChecklistPeople(saved.body, saved.checklistAssigneeRefs, personIds),
          fieldValues
        },
        playbook: saved.playbook === true
      })
      templateIds.set(saved.name.toLocaleLowerCase(), made.id)
    } catch {
      // A clash with a name already there (or the limit): the project's own wins.
    }
  }

  // Each type's fields and template (N2.7b), for the types this file made. A
  // file from before N2.7b names none: its types show every field.
  for (const type of pkg.taskTypes ?? []) {
    const typeId = madeTypes.get(type.ref)
    if (!typeId) continue
    const templateId = type.templateName
      ? (templateIds.get(type.templateName.toLocaleLowerCase()) ?? null)
      : null
    const shown = type.fieldRefs?.flatMap((fieldRef) => fieldIds.get(fieldRef)?.id ?? [])
    if (shown === undefined && templateId === null) continue
    try {
      planning.taskTypes.update(typeId, {
        ...(shown !== undefined ? { fieldIds: [...new Set(shown)] } : {}),
        ...(templateId ? { templateId } : {})
      })
    } catch {
      // Left as every field and no template, like a missing ref.
    }
  }

  // Documents and images are files beside the package: the importer adds them afterwards.
  const libraryRepository = new LibraryRepository(planning.database)
  const libraryIds: (string | null)[] = pkg.library.map(() => null)
  for (const [index, item] of pkg.library.entries()) {
    if (!PACKAGE_TEXT_KINDS.includes(item.kind)) continue
    const created = insertLibraryTextItem(libraryRepository, projectId, {
      kind: item.kind as 'brief' | 'guide' | 'note' | 'link',
      title: item.title,
      summary: item.summary,
      body: item.body,
      url: item.url ?? undefined,
      aiAccess: item.aiAccess ?? undefined,
      tags: item.tags
    })
    libraryIds[index] = created.id
  }

  // Whiteboards (D21) get fresh object ids, by the one rule paste and whiteboard files use.
  // Their pictures are files too: the importer shows them once it has added them.
  const whiteboards = new WhiteboardService(planning.database, libraryRepository, () => {})
  const boards: { id: string; objects: WhiteboardObjectInput[] }[] = []
  for (const [index, item] of pkg.library.entries()) {
    if (item.kind !== 'whiteboard' || !item.whiteboard) continue
    const given = item.whiteboard.objects
    // remapWhiteboardIds keeps the order, so old and new ids pair by position.
    const objects = remapWhiteboardIds(given, uuidv4)
    const newIds = new Map(given.map((object, at) => [object.id, objects[at].id]))
    const created = whiteboards.create(
      projectId,
      { title: item.title, objects },
      {
        summary: item.summary,
        tags: item.tags,
        ...(item.aiAccess ? { aiAccess: item.aiAccess } : {})
      }
    )
    libraryIds[index] = created.item.id
    boards.push({ id: created.item.id, objects })
    for (const picture of item.whiteboard.pictures) {
      const objectId = newIds.get(picture.objectId)
      if (!objectId) continue
      pendingPictures.push({
        whiteboardId: created.item.id,
        objectId,
        libraryIndex: picture.libraryIndex
      })
    }
  }

  // Links in texts and on whiteboard objects to the file's own items now point at the new
  // ones (N4.4a).
  if (pkg.linkIds) {
    const { linkIds } = pkg
    const pairs = (old: string[], made: (string | null | undefined)[]) =>
      new Map(old.flatMap((id, index) => (id && made[index] ? [[id, made[index]!] as const] : [])))
    const maps: ItemLinkIdMaps = {
      fromProjectId: linkIds.projectId,
      toProjectId: projectId,
      ids: {
        task: pairs(
          linkIds.tasks,
          pkg.tasks.map((task) => taskIds.get(task.ref))
        ),
        milestone: pairs(
          linkIds.milestones,
          pkg.milestones.map((milestone) => milestoneIds.get(milestone.ref))
        ),
        decision: pairs(linkIds.decisions, decisionIds),
        library: pairs(linkIds.library, libraryIds)
      }
    }
    planning.rewriteItemLinks(projectId, maps)
    for (const board of boards) {
      const changed = board.objects.flatMap((object): WhiteboardObjectInput[] => {
        if (object.link === null) return []
        const link = rewriteItemLinkUrl(object.link, BRAND.urlScheme, maps)
        return link === object.link ? [] : [{ ...object, link }]
      })
      for (let at = 0; at < changed.length; at += WHITEBOARD_LIMITS.upserts) {
        whiteboards.save(projectId, board.id, {
          upserts: changed.slice(at, at + WHITEBOARD_LIMITS.upserts),
          deletes: []
        })
      }
    }
  }
  // Status updates (N5.5) keep their health, note, author and times.
  if (withTimeEntries && pkg.statusUpdates && pkg.statusUpdates.length > 0) {
    planning.statusUpdates.importUpdates(
      projectId,
      pkg.statusUpdates.map((update) => ({
        health: update.health,
        note: update.note,
        authorKind: update.by === 'automation' ? 'automation' : 'human',
        authorPersonId:
          update.by === 'person' && update.personRef
            ? (personIds.get(update.personRef) ?? null)
            : null,
        postedAt: Date.parse(update.postedAt),
        editedAt: update.editedAt ? Date.parse(update.editedAt) : null
      }))
    )
  }
  // The budget and costs (N6.3a); a template brings planned costs only, dated from today.
  if (pkg.budget) planning.costs.importBudget(projectId, pkg.budget)
  // The hourly rate and default (N6.4), after the budget row they sit beside.
  if (pkg.billingSettings) planning.billing.importSettings(projectId, pkg.billingSettings)
  const costs = (pkg.costs ?? []).filter((cost) => withTimeEntries || cost.state === 'planned')
  let costIds: string[] = []
  if (costs.length > 0) {
    costIds = planning.costs.importCosts(
      projectId,
      costs.map((cost) => ({
        date: day(cost.date)!,
        amount: cost.amount,
        description: cost.description,
        category: cost.category ?? '',
        workItemId: cost.taskRef ? (taskIds.get(cost.taskRef) ?? null) : null,
        milestoneId: cost.milestoneRef ? (milestoneIds.get(cost.milestoneRef) ?? null) : null,
        state: cost.state
      }))
    )
  }
  // Contacts (N6.5) come with an exported project, never with a template:
  // matched by email (or name without one), the missing ones created.
  const contactsByRef = new Map<string, string>()
  if (withTimeEntries && pkg.contacts && pkg.contacts.length > 0) {
    const contactIds = planning.contacts.resolveForImport(pkg.contacts)
    pkg.contacts.forEach((contact, index) => contactsByRef.set(contact.ref, contactIds[index]))
    const byRef = contactsByRef
    planning.contacts.importLinks(
      projectId,
      (pkg.taskContacts ?? []).map((link) => ({
        workItemId: taskIds.get(link.taskRef)!,
        contactId: byRef.get(link.contactRef)!,
        role: link.role
      }))
    )
  }
  // The shopping list (N6.3b), in order. A template brings unbought items with
  // no supplier; a bought item keeps its paid cost, which came in with the costs.
  const shopping = (pkg.shopping ?? []).filter(
    (item) => withTimeEntries || item.costIndex === undefined
  )
  if (shopping.length > 0) {
    planning.shopping.importItems(
      projectId,
      shopping.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit ?? '',
        estimate: item.estimate ?? null,
        contactId: item.supplierRef ? (contactsByRef.get(item.supplierRef) ?? null) : null,
        workItemId: item.taskRef ? (taskIds.get(item.taskRef) ?? null) : null,
        costId: item.costIndex !== undefined ? (costIds[item.costIndex] ?? null) : null
      }))
    )
  }
  // Baselines (N7.4) come with an exported project, never with a template.
  // An entry for an item no longer in the file gets an id of its own, so it
  // reads as gone in the new project as it did in the old one.
  if (withTimeEntries && pkg.baselines && pkg.baselines.length > 0) {
    const goneIds = new Map<string, string>()
    const itemId = (kind: 'task' | 'milestone', ref: string): string => {
      const known = kind === 'task' ? taskIds.get(ref) : milestoneIds.get(ref)
      if (known) return known
      const key = `${kind}:${ref}`
      if (!goneIds.has(key)) goneIds.set(key, uuidv4())
      return goneIds.get(key)!
    }
    planning.baselines.importBaselines(
      projectId,
      pkg.baselines.map((baseline) => ({
        name: baseline.name,
        savedAt: Date.parse(baseline.savedAt),
        entries: baseline.entries.map((entry) => ({
          kind: entry.kind,
          itemId: itemId(entry.kind, entry.ref),
          start: entry.start ?? null,
          due: entry.due ?? null
        }))
      }))
    )
  }
  // Saved views, their ref tokens pointed at the new records; a token for
  // something that did not come along is left out of the view.
  const viewRefIds: Record<ViewRefKind, (ref: string) => string | undefined> = {
    person: (ref) => personIds.get(ref),
    goal: (ref) => goalIds.get(ref),
    milestone: (ref) => milestoneIds.get(ref),
    subproject: (ref) => subprojectIds.get(ref),
    iteration: (ref) => iterationIds.get(ref),
    type: (ref) => typeIds.get(ref),
    field: (ref) => fieldIds.get(ref)?.id,
    option: (ref) => optionIds.get(ref),
    column: (ref) => columnIds.get(ref)?.id,
    contact: (ref) => contactsByRef.get(ref),
    task: (ref) => taskIds.get(ref)
  }
  const viewIds = (pkg.views ?? []).map((view) => {
    const config = viewFromPackage(view, (kind, ref) => viewRefIds[kind](ref))
    return view.default
      ? planning.views.setDefault(projectId, view.viewType, config).id
      : planning.views.create(projectId, { name: view.name, viewType: view.viewType, config }).id
  })
  // The Overview's shortcuts (N5.2a), pointed at the new items. Documents and
  // images are added later by the file importer, so their shortcuts stay behind.
  if (pkg.pins) {
    const made: Record<string, (string | null | undefined)[]> = {
      task: pkg.tasks.map((task) => taskIds.get(task.ref)),
      milestone: pkg.milestones.map((milestone) => milestoneIds.get(milestone.ref)),
      decision: decisionIds,
      library: libraryIds,
      view: viewIds.map((id, index) => (pkg.views![index].default ? null : id))
    }
    planning.pins.importOverviewPins(
      projectId,
      pkg.pins.flatMap((pin): { kind: PinKind; targetId: string }[] => {
        if (pin.kind === 'project-view') return [{ kind: pin.kind, targetId: pin.viewId }]
        const targetId = made[pin.kind][pin.index]
        if (!targetId) return []
        return [{ kind: pin.kind === 'view' ? 'saved-view' : pin.kind, targetId }]
      })
    )
  }
  if (importBatch) batches.finish(importBatch.id, pkg.tasks.length, Date.now())
  return people.created
}

/** A template body with its checklist items' people put back from their refs (N2.2). */
function withChecklistPeople(
  body: TaskTemplateBody,
  refs: Record<string, string> | undefined,
  personIds: Map<string, string>
): Pick<TaskTemplateBody, 'checklistDetails'> {
  const byText = new Map((body.checklistDetails ?? []).map((detail) => [detail.text, detail]))
  for (const [text, ref] of Object.entries(refs ?? {})) {
    const assigneeId = personIds.get(ref) ?? null
    if (!assigneeId) continue
    byText.set(text, { text, dueDate: byText.get(text)?.dueDate ?? null, assigneeId })
  }
  const checklistDetails = body.checklist.flatMap((text) => {
    const detail = byText.get(text)
    return detail ? [detail] : []
  })
  return checklistDetails.length > 0 ? { checklistDetails } : {}
}
