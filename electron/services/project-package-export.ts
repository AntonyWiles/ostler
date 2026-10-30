/** A project as a package (P5.8, P6.1): every record, by ref, and the Library files a full export copies. */

import type {
  PlanningWorkItem,
  PlanningWorkItemStatus,
  ProjectPackageInclude,
  PlanningFieldValues
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { LEGACY_NAMES } from '@shared/legacy-names'
import { packageDependsOnLinks } from '@shared/project-package'
import { todayIsoDate } from '@shared/dates'
import {
  PACKAGE_TEXT_KINDS,
  PROJECT_PACKAGE_FORMAT,
  isRelativeDate,
  relativePackageDate,
  templateWhiteboard,
  type PackageDate,
  type PackageMilestone,
  type PackageLibraryItem,
  type PackageLinkIds,
  type PackageWhiteboard,
  type PackagePin,
  type PackageStatusUpdate,
  type PackageBudget,
  type PackageBilling,
  type PackageContact,
  type PackageTaskContact,
  type PackageBillingSettings,
  type PackageCost,
  type PackageShoppingItem,
  type PackageBaseline,
  type PackageField,
  type PackageFieldValue,
  type PackageIteration,
  type PackageSubproject,
  type PackageTaskType,
  type PackageRule,
  type PackageTask,
  type PackageTaskTemplate,
  type PackageTimeEntry,
  type PackageGithubLink,
  type PackageTaskLink,
  type ProjectPackage,
  viewToPackage,
  type PackageView,
  type ViewRefKind
} from '@shared/project-package'
import { cleanWhiteboardObject } from '@shared/whiteboard/model'
import { PeopleRepository } from './database/people-repository'
import { LibraryRepository } from './database/library-repository'
import { WhiteboardRepository } from './database/whiteboard-repository'
import { customColumns } from '@shared/board-columns'
import { customColumnOf } from '@shared/task-labels'
import { swapRuleRefs, swapTriggerColumn } from '@shared/planning/rule-refs'
import type {
  ExportedLibraryFile,
  ExportPackageOptions,
  ProjectPackageServiceDependencies
} from './project-package-service'

/** What building a package reads: the project, its records, and its Library files. */
export type PackageExportDependencies = Pick<
  ProjectPackageServiceDependencies,
  'planning' | 'getProject' | 'appVersion' | 'libraryFilePath'
>

export function buildProjectPackage(
  deps: PackageExportDependencies,
  projectId: string,
  options: ExportPackageOptions,
  today = todayIsoDate()
): { pkg: ProjectPackage; files: ExportedLibraryFile[] } {
  const project = deps.getProject(projectId)
  const planning = deps.planning
  const db = planning.database
  const template = options.kind === 'template'
  const include: Required<ProjectPackageInclude> = {
    tasks: options.include?.tasks ?? true,
    milestones: options.include?.milestones ?? true,
    labels: options.include?.labels ?? true,
    people: options.include?.people ?? true,
    decisions: options.include?.decisions ?? true,
    library: options.include?.library ?? true,
    comments: !template && (options.include?.comments ?? true),
    taskTemplates: options.include?.taskTemplates ?? true
  }
  const day = (value: string | null): PackageDate | null =>
    options.relativeDates ? relativePackageDate(value, today) : value
  const idsInOrder = (table: string, where = ''): string[] =>
    (
      db
        .prepare(`SELECT id FROM ${table} WHERE project_id = ? ${where} ORDER BY created_at, rowid`)
        .all(projectId) as { id: string }[]
    ).map((row) => row.id)

  const goalRefs = new Map<string, string>()
  const goals = include.milestones
    ? planning
        .listGoals(projectId)
        .sort(byOrder(idsInOrder('planning_goals')))
        .map((goal, index) => {
          const ref = `g${index + 1}`
          goalRefs.set(goal.id, ref)
          // Its measure (N5.6a), dates relative in a template; check-ins never in one.
          const checkIns = template ? [] : planning.goalCheckIns.list(goal.id)
          return {
            ref,
            title: goal.title,
            outcome: goal.outcome,
            status: goal.status,
            ...(goal.measure
              ? {
                  measure: {
                    ...goal.measure,
                    startDate: day(goal.measure.startDate)!,
                    targetDate: day(goal.measure.targetDate)!
                  }
                }
              : {}),
            ...(checkIns.length > 0
              ? {
                  checkIns: checkIns.map((checkIn) => ({
                    date: checkIn.date,
                    value: checkIn.value,
                    note: checkIn.note,
                    recordedAt: new Date(checkIn.recordedAt).toISOString()
                  }))
                }
              : {})
          }
        })
    : []
  // Rounds (N5.7a): a template carries one round of each series, its latest,
  // with its tasks and its rule; earlier rounds and their tasks stay behind.
  const allMilestones = include.milestones ? planning.listMilestones(projectId) : []
  const earlierRounds = new Set(
    template ? allMilestones.flatMap((milestone) => milestone.previousRoundId ?? []) : []
  )
  // Workstreams, in the project's order; archived ones stay behind.
  const keptSubprojects = planning.subprojects
    .list(projectId)
    .filter((subproject) => subproject.archivedAt === null)
  const subprojectRefs = new Map(
    keptSubprojects.map((subproject, index) => [subproject.id, `s${index + 1}`])
  )
  const subprojectRefOf = (id: string | null | undefined) =>
    id ? subprojectRefs.get(id) : undefined
  const milestoneRefs = new Map<string, string>()
  const keptMilestones = allMilestones
    .filter((milestone) => !earlierRounds.has(milestone.id))
    .sort(byOrder(idsInOrder('planning_milestones')))
  keptMilestones.forEach((milestone, index) => milestoneRefs.set(milestone.id, `m${index + 1}`))
  const milestones = keptMilestones.map((milestone): PackageMilestone => {
    const previousRoundRef =
      !template && milestone.previousRoundId
        ? milestoneRefs.get(milestone.previousRoundId)
        : undefined
    const roundStart = milestone.roundStart ? day(milestone.roundStart) : null
    const subprojectRef = subprojectRefOf(milestone.subprojectId)
    return {
      ref: milestoneRefs.get(milestone.id)!,
      goalRef: milestone.goalId ? (goalRefs.get(milestone.goalId) ?? null) : null,
      name: milestone.name,
      outcome: milestone.outcome,
      targetDate: day(milestone.targetDate),
      successCriteria: milestone.successCriteria,
      status: template ? 'planned' : milestone.status,
      ...(milestone.repeat
        ? { repeat: { ...milestone.repeat, nextStart: day(milestone.repeat.nextStart)! } }
        : {}),
      ...(roundStart ? { roundStart } : {}),
      ...(previousRoundRef ? { previousRoundRef } : {}),
      ...(subprojectRef ? { subprojectRef } : {})
    }
  })

  // Task types (N2.7a), in the project's order: a template keeps them all.
  const typeRefs = new Map<string, string>()
  const projectTypes = planning.taskTypes.list(projectId)
  const taskTypes: PackageTaskType[] = projectTypes.map((type, index) => {
    const ref = `y${index + 1}`
    typeRefs.set(type.id, ref)
    return { ref, name: type.name, icon: type.icon, color: type.color }
  })
  /**
   * Each type's fields by ref and its template by name (N2.7b), once the
   * fields and templates have refs. A template that does not travel (every
   * project's, or task templates left out) is left off.
   */
  const withTypeSettings = (types: PackageTaskType[]): PackageTaskType[] =>
    types.map((entry, index) => {
      const type = projectTypes[index]
      const template = type.templateId
        ? taskTemplates.find((_saved, i) => travellingTemplateIds[i] === type.templateId)
        : undefined
      return {
        ...entry,
        ...(type.fieldIds
          ? { fieldRefs: type.fieldIds.flatMap((id) => fieldRefs.get(id) ?? []) }
          : {}),
        ...(template ? { templateName: template.name } : {})
      }
    })

  // Iterations (R6.1): a template keeps the unfinished ones, as planned.
  const iterationRefs = new Map<string, string>()
  const iterations: PackageIteration[] = include.milestones
    ? planning.iterations
        .list(projectId)
        .filter((iteration) => !template || iteration.status !== 'finished')
        .map((iteration, index) => {
          const ref = `i${index + 1}`
          iterationRefs.set(iteration.id, ref)
          const summary = iteration.summary
          return {
            ref,
            name: iteration.name,
            startDate: day(iteration.startDate)!,
            endDate: day(iteration.endDate)!,
            goal: iteration.goal,
            status: template ? 'planned' : iteration.status,
            summary:
              !template && summary
                ? {
                    doneCount: summary.doneCount,
                    doneEstimate: summary.doneEstimate,
                    carriedCount: summary.carriedCount,
                    carriedEstimate: summary.carriedEstimate,
                    carryOver: summary.carryOver
                  }
                : null
          }
        })
    : []

  const items = include.tasks
    ? // In the manual order (D31), which the file keeps. Won't-do tasks
      // (N1.2) are records too: they travel, marked, after the live ones.
      [
        ...planning.listWorkItems(projectId),
        ...planning
          .listWorkItems(projectId, 'archived')
          .filter((item) => item.resolution === 'wont-do')
      ].filter((item) => !item.milestoneId || !earlierRounds.has(item.milestoneId))
    : []
  const taskRefs = new Map(items.map((item, index) => [item.id, `t${index + 1}`]))

  // Custom fields (R2.2): every definition, and each task's values by ref.
  const fieldRefs = new Map<string, string>()
  const optionRefs = new Map<string, string>()
  const packageFields: PackageField[] = planning.listFields(projectId).map((field, index) => {
    const ref = `f${index + 1}`
    fieldRefs.set(field.id, ref)
    return {
      ref,
      name: field.name,
      type: field.type,
      options: field.options.map((option, optionIndex) => {
        const optionRef = `o${optionIndex + 1}`
        optionRefs.set(option.id, optionRef)
        return { ref: optionRef, name: option.name, color: option.color || null }
      }),
      ...(field.aiInstruction ? { aiInstruction: field.aiInstruction } : {})
    }
  })
  const fieldDefs = new Map(planning.listFields(projectId).map((field) => [field.id, field]))
  /**
   * Values by field id as values by field ref. A task template's (N2.1)
   * dates are relative already, and a value its field no longer takes is
   * left out, as the template would drop it when used.
   */
  const packageValues = (
    given: PlanningFieldValues,
    date: (value: string) => PackageDate | null = day
  ): PackageTask['fieldValues'] => {
    const values: Record<string, PackageFieldValue> = {}
    for (const [fieldId, value] of Object.entries(given)) {
      const ref = fieldRefs.get(fieldId)
      const field = fieldDefs.get(fieldId)
      if (!ref || !field) continue
      if (field.type === 'choice') {
        const optionRef = optionRefs.get(String(value))
        if (optionRef) values[ref] = optionRef
      } else if (field.type === 'choices') {
        if (!Array.isArray(value)) continue
        const refs = value.flatMap((id) => optionRefs.get(id) ?? [])
        if (refs.length > 0) values[ref] = refs
      } else if (field.type === 'date') {
        const shifted = typeof value === 'string' ? date(value) : null
        if (shifted) values[ref] = shifted
      } else if (
        (field.type === 'text' && typeof value === 'string') ||
        (field.type === 'number' && typeof value === 'number') ||
        (field.type === 'checkbox' && value === true)
      )
        values[ref] = value
    }
    return Object.keys(values).length > 0 ? values : undefined
  }
  const personRefs = new Map<string, string>()
  const personRef = (personId: string | null): string | null => {
    if (!personId || !include.people) return null
    if (!personRefs.has(personId)) personRefs.set(personId, `p${personRefs.size + 1}`)
    return personRefs.get(personId)!
  }
  const subprojects = keptSubprojects.map((subproject): PackageSubproject => ({
    ref: subprojectRefs.get(subproject.id)!,
    name: subproject.name,
    description: subproject.description,
    color: subproject.color,
    ...(subproject.icon ? { icon: subproject.icon } : {}),
    leadRef: personRef(subproject.leadId),
    memberRefs: subproject.memberIds.flatMap((id) => personRef(id) ?? []),
    status: subproject.status
  }))
  // The project's own columns (MOP-26) by ref, for the tasks in them.
  const columns = planning.columns.get(projectId)
  const columnRefs = new Map(
    customColumns(columns).map((column, index) => [column.id, `column-${index + 1}`])
  )
  const tasks: PackageTask[] = items.map((item) => {
    const task = exportTask(deps, item, taskRefs, {
      template,
      milestoneRef: item.milestoneId ? (milestoneRefs.get(item.milestoneId) ?? null) : null,
      assigneeRef: personRef(item.assigneeId),
      personRef,
      day
    })
    const fieldValues = packageValues(item.fieldValues ?? {})
    const iterationRef = item.iterationId ? iterationRefs.get(item.iterationId) : undefined
    const withIteration = iterationRef ? { ...task, iterationRef } : task
    const typeRef = item.typeId ? typeRefs.get(item.typeId) : undefined
    const typed = typeRef ? { ...withIteration, typeRef } : withIteration
    const subprojectRef = subprojectRefOf(item.subprojectId)
    const withType = subprojectRef ? { ...typed, subprojectRef } : typed
    // The task of the earlier round it came from (N5.7a), when that is in the file too.
    const roundSourceRef =
      !template && item.roundSourceId ? taskRefs.get(item.roundSourceId) : undefined
    const withRoundSource = roundSourceRef ? { ...withType, roundSourceRef } : withType
    const columnRef = customColumnOf(item, columns) ? columnRefs.get(item.columnId!) : undefined
    const withRound = columnRef ? { ...withRoundSource, columnRef } : withRoundSource
    // Which of those values Ostler AI filled (N8.4), with the text they came from.
    const aiFills: NonNullable<PackageTask['aiFills']> = {}
    for (const [fieldId, fill] of Object.entries(item.fieldFills ?? {})) {
      const ref = fieldRefs.get(fieldId)
      if (
        ref &&
        fieldValues?.[ref] !== undefined &&
        fill.filledBy === 'ostler-ai' &&
        fill.sourceHash
      )
        aiFills[ref] = { sourceHash: fill.sourceHash }
    }
    const withValues = fieldValues ? { ...withRound, fieldValues } : withRound
    return Object.keys(aiFills).length > 0 ? { ...withValues, aiFills } : withValues
  })

  const comments = include.comments
    ? items.flatMap((item) =>
        planning
          .listComments(item.id)
          .filter((comment) => comment.deletedAt === null)
          .map((comment) => ({
            taskRef: taskRefs.get(item.id)!,
            authorRef: personRef(comment.authorPersonId),
            body: comment.body
          }))
      )
    : []

  // Billings (N6.4), by ref, with the totals they kept; a template carries none.
  const billingRefs = new Map<string, string>()
  const billings: PackageBilling[] = template
    ? []
    : planning.billing
        .listBillings(projectId)
        .reverse()
        .map((billing, index) => {
          const ref = `b${index + 1}`
          billingRefs.set(billing.id, ref)
          return {
            ref,
            from: billing.from,
            to: billing.to,
            markedAt: new Date(billing.markedAt).toISOString(),
            entryCount: billing.entryCount,
            billableSeconds: billing.billableSeconds,
            hourlyRate: billing.hourlyRate,
            amount: billing.amount,
            currency: billing.currency
          }
        })
  // Contacts (N6.5): only those the file's tasks name, by ref; a template carries none.
  const contactRefs = new Map<string, string>()
  const contacts: PackageContact[] = []
  const taskContacts: PackageTaskContact[] = []
  if (!template) {
    for (const link of planning.contacts.linksForProject(projectId)) {
      const taskRef = taskRefs.get(link.workItemId)
      if (!taskRef) continue
      let contactRef = contactRefs.get(link.contactId)
      if (!contactRef) {
        const contact = planning.contacts.get(link.contactId)
        contactRef = `c${contactRefs.size + 1}`
        contactRefs.set(contact.id, contactRef)
        contacts.push({
          ref: contactRef,
          name: contact.name,
          organisation: contact.organisation,
          role: contact.role,
          phones: contact.phones,
          emails: contact.emails,
          website: contact.website,
          address: contact.address,
          notes: contact.notes
        })
      }
      taskContacts.push({ taskRef, contactRef, role: link.role })
    }
  }
  // The hourly rate and default (N6.4); a template carries these too.
  const billingSettings: PackageBillingSettings | null = (({ hourlyRate, newTimeBillable }) =>
    hourlyRate !== null || newTimeBillable ? { hourlyRate, newTimeBillable } : null)(
    planning.billing.getSettings(projectId)
  )

  // Finished time entries (R2.3); a template carries none.
  const timeEntries: PackageTimeEntry[] = template
    ? []
    : planning.time
        .listForProject(projectId)
        .filter((entry) => entry.durationSeconds !== null && taskRefs.has(entry.workItemId))
        .map((entry) => ({
          taskRef: taskRefs.get(entry.workItemId)!,
          personRef: personRef(entry.personId),
          startedAt: new Date(entry.startedAt).toISOString(),
          durationSeconds: entry.durationSeconds!,
          note: entry.note,
          source: entry.source,
          ...(entry.billable ? { billable: true } : {}),
          ...(entry.billingId && billingRefs.has(entry.billingId)
            ? { billingRef: billingRefs.get(entry.billingId) }
            : {})
        }))

  // GitHub links (R4.4), without their cached title and state; a template carries none.
  const githubLinks: PackageGithubLink[] = template
    ? []
    : planning.githubLinks
        .listForProject(projectId)
        .filter((link) => taskRefs.has(link.workItemId))
        .map((link) => ({ taskRef: taskRefs.get(link.workItemId)!, url: link.url }))

  // Links between tasks (N2.4), both ends in the file; a template carries none.
  const taskLinks: PackageTaskLink[] = template
    ? []
    : planning
        .listProjectLinks(projectId)
        .filter((link) => taskRefs.has(link.fromWorkItemId) && taskRefs.has(link.toWorkItemId))
        .map((link) => ({
          fromRef: taskRefs.get(link.fromWorkItemId)!,
          toRef: taskRefs.get(link.toWorkItemId)!,
          kind: link.kind
        }))

  // Rules (R6.2); a template carries none. One naming something the file
  // leaves out (people, milestones) is left out too.
  const rules: PackageRule[] = template
    ? []
    : planning.rules.list(projectId).flatMap((rule) => {
        const column = (id: string) => columnRefs.get(id)
        const swapped = swapRuleRefs(rule, {
          person: (id) => personRef(id) ?? undefined,
          milestone: (id) => milestoneRefs.get(id),
          column,
          field: (fieldId, value) => {
            const ref = fieldRefs.get(fieldId)
            const field = fieldDefs.get(fieldId)
            if (!ref || !field) return undefined
            if (field.type === 'choice') {
              const optionRef = optionRefs.get(String(value))
              return optionRef ? { fieldId: ref, value: optionRef } : undefined
            }
            if (field.type === 'choices' && Array.isArray(value)) {
              const refs = value.map((id) => optionRefs.get(String(id)))
              return refs.every((entry) => entry !== undefined)
                ? { fieldId: ref, value: refs as string[] }
                : undefined
            }
            return { fieldId: ref, value }
          }
        })
        return swapped
          ? [
              {
                name: rule.name,
                enabled: rule.enabled,
                trigger: swapTriggerColumn(rule.trigger, column),
                ...swapped
              }
            ]
          : []
      })

  // Status updates (N5.5), oldest first, with who posted them; a template carries none.
  const statusUpdates: PackageStatusUpdate[] = template
    ? []
    : planning.statusUpdates.stored(projectId).map((update) => ({
        health: update.health,
        note: update.note,
        by: update.authorKind === 'automation' ? 'automation' : 'person',
        ...(update.authorKind === 'human' ? { personRef: personRef(update.authorPersonId) } : {}),
        postedAt: new Date(update.postedAt).toISOString(),
        ...(update.editedAt !== null ? { editedAt: new Date(update.editedAt).toISOString() } : {})
      }))

  // The budget and costs (N6.3a); a template carries planned costs only, dates relative.
  const budget: PackageBudget | null = planning.costs.hasBudget(projectId)
    ? (({ amount, currency }) => ({ amount, currency }))(planning.costs.getBudget(projectId))
    : null
  const costRows = planning.costs.list(projectId, template ? { state: 'planned' } : {})
  const costs: PackageCost[] = costRows.map((cost) => ({
    date: day(cost.date)!,
    amount: cost.amount,
    description: cost.description,
    ...(cost.category ? { category: cost.category } : {}),
    ...(cost.workItemId && taskRefs.has(cost.workItemId)
      ? { taskRef: taskRefs.get(cost.workItemId) }
      : {}),
    ...(cost.milestoneId && milestoneRefs.has(cost.milestoneId)
      ? { milestoneRef: milestoneRefs.get(cost.milestoneId) }
      : {}),
    state: cost.state
  }))
  // The shopping list (N6.3b): a bought item points at its paid cost by place;
  // a template carries unbought items only, with no supplier.
  const costIndex = new Map(costRows.map((cost, index) => [cost.id, index]))
  const shopping: PackageShoppingItem[] = planning.shopping
    .list(projectId)
    .filter((item) => !template || item.costId === null)
    .map((item) => {
      let supplierRef: string | undefined
      if (!template && item.contactId) {
        supplierRef = contactRefs.get(item.contactId)
        if (!supplierRef) {
          const contact = planning.contacts.get(item.contactId)
          supplierRef = `c${contactRefs.size + 1}`
          contactRefs.set(contact.id, supplierRef)
          contacts.push({
            ref: supplierRef,
            name: contact.name,
            organisation: contact.organisation,
            role: contact.role,
            phones: contact.phones,
            emails: contact.emails,
            website: contact.website,
            address: contact.address,
            notes: contact.notes
          })
        }
      }
      const bought = item.costId !== null ? costIndex.get(item.costId) : undefined
      return {
        name: item.name,
        quantity: item.quantity,
        ...(item.unit ? { unit: item.unit } : {}),
        ...(item.estimate !== null ? { estimate: item.estimate } : {}),
        ...(supplierRef ? { supplierRef } : {}),
        ...(item.workItemId && taskRefs.has(item.workItemId)
          ? { taskRef: taskRefs.get(item.workItemId) }
          : {}),
        ...(bought !== undefined ? { costIndex: bought } : {})
      }
    })

  // Baselines (N7.4), newest first; never in a template. An item no longer
  // in the file keeps its entry under a ref of its own (`gone1`), so the
  // new project reads it as gone.
  const goneRefs = new Map<string, string>()
  const entryRef = (kind: 'task' | 'milestone', id: string): string => {
    const known = kind === 'task' ? taskRefs.get(id) : milestoneRefs.get(id)
    if (known) return known
    const key = `${kind}:${id}`
    if (!goneRefs.has(key)) goneRefs.set(key, `gone${goneRefs.size + 1}`)
    return goneRefs.get(key)!
  }
  const baselines: PackageBaseline[] = template
    ? []
    : planning.baselines.list(projectId).map((summary) => {
        const baseline = planning.baselines.get(projectId, summary.id)
        return {
          name: baseline.name,
          savedAt: new Date(baseline.savedAt).toISOString(),
          entries: baseline.entries.map((entry) => ({
            kind: entry.kind,
            ref: entryRef(entry.kind, entry.itemId),
            ...(entry.start ? { start: entry.start } : {}),
            ...(entry.due ? { due: entry.due } : {})
          }))
        }
      })

  const peopleRepository = new PeopleRepository(db)

  // The project's own task templates (N2.1), the assignee and field values by
  // ref beside each body. Their dates are relative already.
  const travellingTemplateIds = include.taskTemplates
    ? planning.taskTemplates.listOwn(projectId).map((saved) => saved.id)
    : []
  const taskTemplates: PackageTaskTemplate[] = include.taskTemplates
    ? planning.taskTemplates.listOwn(projectId).map((saved) => {
        const assigneeId = saved.body.assigneeId
        const assigneeRef =
          assigneeId && peopleRepository.get(assigneeId) ? personRef(assigneeId) : null
        const fieldValues = packageValues(saved.body.fieldValues, (value) =>
          isRelativeDate(value) ? value : null
        )
        // Checklist items' people by ref too (N2.2); the body keeps their dates.
        const checklistAssigneeRefs: Record<string, string> = {}
        const details = (saved.body.checklistDetails ?? []).flatMap((detail) => {
          const ref =
            detail.assigneeId && peopleRepository.get(detail.assigneeId)
              ? personRef(detail.assigneeId)
              : null
          if (ref) checklistAssigneeRefs[detail.text] = ref
          return detail.dueDate ? [{ ...detail, assigneeId: null }] : []
        })
        return {
          name: saved.name,
          body: {
            ...saved.body,
            checklistDetails: details.length > 0 ? details : undefined,
            assigneeId: null,
            fieldValues: {}
          },
          assigneeRef,
          // A playbook (N9.6b) travels as one; its agent part is in the body.
          ...(saved.playbook ? { playbook: true } : {}),
          ...(Object.keys(checklistAssigneeRefs).length > 0 ? { checklistAssigneeRefs } : {}),
          ...(fieldValues ? { fieldValues } : {})
        }
      })
    : []

  // Saved views, before the people: a person a view names travels with it.
  const viewTokens = new Map<string, string>()
  const addTokens = (kind: ViewRefKind, refs: Map<string, string>) =>
    refs.forEach((ref, id) => viewTokens.set(id, `#${kind}.${ref}`))
  addTokens('goal', goalRefs)
  addTokens('milestone', milestoneRefs)
  addTokens('subproject', subprojectRefs)
  addTokens('iteration', iterationRefs)
  addTokens('type', typeRefs)
  addTokens('field', fieldRefs)
  addTokens('column', columnRefs)
  addTokens('contact', contactRefs)
  addTokens('task', taskRefs)
  for (const field of planning.listFields(projectId))
    for (const option of field.options)
      viewTokens.set(option.id, `#option.${fieldRefs.get(field.id)}/${optionRefs.get(option.id)}`)
  const savedViews = planning.views.list(projectId)
  const views: PackageView[] = savedViews.map((view) =>
    viewToPackage(view, (id) => {
      const token = viewTokens.get(id)
      if (token !== undefined) return token
      const ref = peopleRepository.get(id) ? personRef(id) : null
      return ref ? `#person.${ref}` : undefined
    })
  )

  const people = [...personRefs.entries()].flatMap(([id, ref]) => {
    const person = peopleRepository.get(id)
    return person
      ? [
          {
            ref,
            name: person.name,
            initials: peopleRepository.storedInitials(id),
            color: person.color
          }
        ]
      : []
  })

  const usedLabels = new Set(tasks.flatMap((task) => task.labels))
  const labels = include.labels
    ? planning
        .listProjectLabels(projectId)
        .filter((label) => usedLabels.has(label.name))
        .map((label) => ({ name: label.name, color: label.color }))
    : []

  const decisionRecords = include.decisions
    ? planning.listDecisions(projectId).sort(byOrder(idsInOrder('planning_decisions')))
    : []
  const decisions = include.decisions
    ? decisionRecords.map((decision) => ({
        title: decision.title,
        context: decision.context,
        decision: decision.decision,
        alternatives: decision.alternativesConsidered,
        consequences: decision.consequences,
        date: day(decision.date),
        taskRefs: decision.linkedWorkItemIds.flatMap((id) =>
          taskRefs.has(id) ? [taskRefs.get(id)!] : []
        )
      }))
    : []

  // A template carries text items and whiteboards; a full export also lists its files,
  // which `exportProjectFile` packs into `library/` beside the package.
  const files: ExportedLibraryFile[] = []
  const usedNames = new Set<string>()
  const libraryItemIds: string[] = []
  const boardObjects = new WhiteboardRepository(db)
  // Each whiteboard's image objects and the pictures they show, by the board's place in the file.
  const boardPictures = new Map<number, { objectId: string; imageItemId: string }[]>()
  const library: PackageLibraryItem[] = include.library
    ? new LibraryRepository(db)
        .listItems(projectId, { includeArchived: false }, null)
        .filter(
          (item): item is typeof item & { kind: PackageLibraryItem['kind'] } =>
            PACKAGE_TEXT_KINDS.includes(item.kind) ||
            item.kind === 'whiteboard' ||
            (!template && item.file !== null && deps.libraryFilePath !== undefined)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title))
        .flatMap((item): PackageLibraryItem[] => {
          if (item.kind === 'whiteboard') {
            // In the file an image object names its picture only through `pictures` (D21).
            const shown: { objectId: string; imageItemId: string }[] = []
            const objects = boardObjects.listObjects(item.id).map((stored) => {
              const object = cleanWhiteboardObject(stored)
              if (object.kind !== 'image') return object
              if (object.data.imageItemId !== null)
                shown.push({ objectId: object.id, imageItemId: object.data.imageItemId })
              return { ...object, data: { ...object.data, imageItemId: null } }
            })
            boardPictures.set(libraryItemIds.length, shown)
            libraryItemIds.push(item.id)
            return [
              {
                kind: item.kind,
                title: item.title,
                summary: item.summary,
                body: '',
                url: null,
                aiAccess: item.aiAccess,
                tags: item.tags,
                file: null,
                whiteboard: { objects, pictures: [] }
              }
            ]
          }
          let file: string | null = null
          if (!PACKAGE_TEXT_KINDS.includes(item.kind)) {
            let sourcePath: string
            try {
              sourcePath = deps.libraryFilePath!(projectId, item.id)
            } catch {
              return [] // The stored file is missing: nothing to carry.
            }
            file = `library/${uniqueFileName(item.file!.fileName, usedNames)}`
            files.push({ file, sourcePath })
          }
          libraryItemIds.push(item.id)
          return [
            {
              kind: item.kind,
              title: item.title,
              summary: item.summary,
              body: item.body,
              url: item.url,
              aiAccess: item.aiAccess,
              tags: item.tags,
              file
            }
          ]
        })
    : []
  // A picture travels when its image is in this file; a template carries none (D21).
  const placeInLibrary = new Map(libraryItemIds.map((id, index) => [id, index]))
  for (const [index, shown] of boardPictures) {
    const board = library[index].whiteboard as PackageWhiteboard
    library[index].whiteboard = template
      ? templateWhiteboard(board)
      : {
          objects: board.objects,
          pictures: shown.flatMap(({ objectId, imageItemId }) => {
            const libraryIndex = placeInLibrary.get(imageItemId)
            return libraryIndex !== undefined && library[libraryIndex].kind === 'image'
              ? [{ objectId, libraryIndex }]
              : []
          })
        }
  }

  // The Board's column names, hidden and own columns (R2.4, MOP-26), when not the standard ones.
  const custom = customColumns(columns).map((column) => ({
    ref: columnRefs.get(column.id)!,
    name: column.name,
    countsAs: column.countsAs,
    ...(column.hidden ? { hidden: true } : {})
  }))
  const hasColumns =
    Object.keys(columns.names).length > 0 || columns.hidden.length > 0 || custom.length > 0

  // The ids links in texts name (N4.4a), only when some text holds a link.
  const schemes = [`${BRAND.urlScheme}://`, `${LEGACY_NAMES.urlScheme}://`]
  const linked = [
    ...tasks.map((task) => task.description),
    ...comments.map((comment) => comment.body),
    ...decisions.flatMap((d) => [d.context, d.decision, d.alternatives, d.consequences]),
    ...library.flatMap((item) => [item.summary, item.body]),
    ...library.flatMap((item) => item.whiteboard?.objects.flatMap((o) => o.link ?? []) ?? [])
  ].some((text) => schemes.some((scheme) => text.includes(scheme)))
  const milestoneIdList = keptMilestones.map((milestone) => milestone.id)
  const linkIds: PackageLinkIds | null = linked
    ? {
        projectId,
        tasks: items.map((item) => item.id),
        milestones: milestoneIdList,
        decisions: decisionRecords.map((decision) => decision.id),
        library: libraryItemIds
      }
    : null

  // The Overview's shortcuts (N5.2a), by their items' places in this file.
  // Sidebar pins are the person's.
  const placeOf: Record<string, string[]> = {
    task: items.map((item) => item.id),
    milestone: milestoneIdList,
    decision: decisionRecords.map((decision) => decision.id),
    library: libraryItemIds,
    'saved-view': savedViews.map((view) => view.id)
  }
  const pins: PackagePin[] = planning.pins.overviewPins(projectId).flatMap((pin): PackagePin[] => {
    if (pin.kind === 'project-view') return [{ kind: 'project-view', viewId: pin.targetId }]
    // Goals of one's own (N5.6b) never travel; they pin to the sidebar only anyway.
    if (pin.kind === 'personal-goal') return []
    const index = placeOf[pin.kind].indexOf(pin.targetId)
    if (index === -1) return []
    return [{ kind: pin.kind === 'saved-view' ? 'view' : pin.kind, index }]
  })

  const pkg: ProjectPackage = {
    format: PROJECT_PACKAGE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    app: { name: BRAND.name, version: deps.appVersion },
    template: template ? { description: 'Saved from a project.', icon: 'file' } : null,
    project: {
      name: project.name,
      color: project.color || null,
      estimateUnit: project.estimateUnit ?? 'points',
      ...(project.icon ? { icon: project.icon } : {}),
      ...(!template && project.taskPrefix ? { taskPrefix: project.taskPrefix } : {})
    },
    people,
    labels,
    ...(packageFields.length > 0 ? { fields: packageFields } : {}),
    goals,
    milestones,
    ...(subprojects.length > 0 ? { subprojects } : {}),
    ...(iterations.length > 0 ? { iterations } : {}),
    ...(taskTypes.length > 0 ? { taskTypes: withTypeSettings(taskTypes) } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    tasks,
    decisions,
    comments,
    ...(timeEntries.length > 0 ? { timeEntries } : {}),
    ...(githubLinks.length > 0 ? { githubLinks } : {}),
    ...(taskLinks.length > 0 ? { taskLinks } : {}),
    ...(hasColumns
      ? {
          columns: {
            names: columns.names,
            hidden: columns.hidden,
            ...(custom.length > 0 ? { custom } : {})
          }
        }
      : {}),
    library,
    ...(taskTemplates.length > 0 ? { taskTemplates } : {}),
    ...(linkIds ? { linkIds } : {}),
    ...(pins.length > 0 ? { pins } : {}),
    ...(views.length > 0 ? { views } : {}),
    ...(statusUpdates.length > 0 ? { statusUpdates } : {}),
    ...(budget ? { budget } : {}),
    ...(costs.length > 0 ? { costs } : {}),
    ...(billingSettings ? { billingSettings } : {}),
    ...(billings.length > 0 ? { billings } : {}),
    ...(contacts.length > 0 ? { contacts, taskContacts } : {}),
    ...(shopping.length > 0 ? { shopping } : {}),
    ...(baselines.length > 0 ? { baselines } : {})
  }
  return { pkg, files }
}

function exportTask(
  deps: PackageExportDependencies,
  item: PlanningWorkItem,
  taskRefs: Map<string, string>,
  context: {
    template: boolean
    milestoneRef: string | null
    assigneeRef: string | null
    personRef: (personId: string | null) => string | null
    day: (value: string | null) => PackageDate | null
  }
): PackageTask {
  const details = new Map((item.checklistDetails ?? []).map((detail) => [detail.text, detail]))
  const recurrence = deps.planning.getRecurrence(item.id)
  const status: PlanningWorkItemStatus =
    context.template && item.status !== 'ready' ? 'backlog' : item.status
  return {
    ref: taskRefs.get(item.id)!,
    milestoneRef: context.milestoneRef,
    parentRef: item.parentWorkItemId ? (taskRefs.get(item.parentWorkItemId) ?? null) : null,
    title: item.title,
    description: item.description,
    status,
    priority: item.priority,
    labels: item.labels,
    checklist: item.acceptanceCriteria.map((text) => {
      const detail = details.get(text)
      const dueDate = context.day(detail?.dueDate ?? null)
      const assigneeRef = context.personRef(detail?.assigneeId ?? null)
      return {
        text,
        checked: !context.template && item.checkedCriteria.includes(text),
        ...(dueDate !== null ? { dueDate } : {}),
        ...(assigneeRef !== null ? { assigneeRef } : {})
      }
    }),
    assigneeRef: context.assigneeRef,
    startDate: context.day(item.startDate),
    dueDate: context.day(item.targetDate),
    estimate: item.estimate,
    dependsOnRefs: item.dependencyIds.flatMap((id) =>
      taskRefs.has(id) ? [taskRefs.get(id)!] : []
    ),
    ...packageDependsOnLinks(item, taskRefs),
    recurrence: recurrence
      ? {
          rule: recurrence.rule,
          endsOn: context.day(recurrence.endsOn),
          remaining: recurrence.remaining,
          ...(recurrence.rotation
            ? {
                rotationRefs: recurrence.rotation.map((id) => context.personRef(id)!),
                nextIndex: recurrence.nextIndex
              }
            : {}),
          ...(recurrence.goToAgents ? { goToAgents: true as const } : {})
        }
      : null,
    ...(item.showFrom ? { showFrom: context.day(item.showFrom)! } : {}),
    ...(item.someday ? { someday: true } : {}),
    ...(item.impact ? { impact: item.impact } : {}),
    ...(item.effort ? { effort: item.effort } : {}),
    // Its number (N9.8a) travels in a project file, never in a template.
    ...(!context.template && item.number ? { number: item.number } : {}),
    ...(item.resolution
      ? {
          resolution: item.resolution,
          ...(item.resolutionReason ? { resolutionReason: item.resolutionReason } : {})
        }
      : {})
  }
}

function byOrder(ids: string[]): (a: { id: string }, b: { id: string }) => number {
  const rank = new Map(ids.map((id, index) => [id, index]))
  return (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
}

/** A Library file's name in an export's `library/`, unique within it. */
function uniqueFileName(fileName: string, used: Set<string>): string {
  const clean =
    [...fileName]
      .map((char) => (/[\\/:*?"<>|]/.test(char) || char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .slice(0, 150) || 'file'
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const extension = dot > 0 ? clean.slice(dot) : ''
  let name = clean
  for (let index = 2; used.has(name.toLowerCase()); index++) name = `${stem} (${index})${extension}`
  used.add(name.toLowerCase())
  return name
}
