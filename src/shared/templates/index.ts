import { localizeDemoMoney } from '../demo-money'
import type { DemoKind } from '../ostler-api/project-types'
import { ADVANCED_DEMO_TEMPLATE_ID, SAMPLE_TEMPLATE_ID } from '../ostler-api/template-types'
import blank from './blank.json'
import contentCalendar from './content-calendar.json'
import demoAdvanced from './demo-advanced.json'
import { DEMO_ENGLISH_NAMES, translateTemplate } from './template-text'
import eventPlanning from './event-planning.json'
import marketingCampaign from './marketing-campaign.json'
import movingHouse from './moving-house.json'
import productLaunch from './product-launch.json'
import sample from './sample.json'
import softwareProject from './software-project.json'
import studyPlan from './study-plan.json'
import websiteLaunch from './website-launch.json'

/** The demos' files as written, in English, with the names they are made with. */
export const DEMO_SOURCES: Record<DemoKind, Record<string, unknown>> = {
  simple: { ...sample, project: { ...sample.project, name: DEMO_ENGLISH_NAMES.simple } },
  advanced: {
    ...demoAdvanced,
    project: { ...demoAdvanced.project, name: DEMO_ENGLISH_NAMES.advanced }
  }
}

/**
 * Every built-in template's file as written, in English, by id, in the order
 * the picker shows them. `BUILT_IN_TEMPLATES` reads each in the language shown.
 */
export const TEMPLATE_SOURCES: Readonly<Record<string, Record<string, unknown>>> = {
  blank,
  'software-project': softwareProject,
  'website-launch': websiteLaunch,
  'marketing-campaign': marketingCampaign,
  'event-planning': eventPlanning,
  'content-calendar': contentCalendar,
  'product-launch': productLaunch,
  'moving-house': movingHouse,
  'study-plan': studyPlan,
  [SAMPLE_TEMPLATE_ID]: DEMO_SOURCES.simple,
  [ADVANCED_DEMO_TEMPLATE_ID]: DEMO_SOURCES.advanced
}

/** The anchor each demo's dates are written around. */
const DEMO_ANCHORS: Record<string, string> = { [ADVANCED_DEMO_TEMPLATE_ID]: '2026-01-15' }

/** The demos' money is only in a currency when they are read. */
const DEMO_IDS = new Set([SAMPLE_TEMPLATE_ID, ADVANCED_DEMO_TEMPLATE_ID])

/**
 * The templates that ship with the app, as project package files (P5.8), in
 * the order the picker shows them. Each is checked by
 * `validateProjectPackage` when it is used, and every file in this folder is
 * checked by the tests. The demo projects take their names from `BRAND`.
 *
 * A template with `demo` is a demo project that comes with its history, as a
 * project file does: time, billings, status updates, rules, contacts, links
 * and a baseline. Its absolute dates are written around `demo.anchor` and
 * move to today when it is used (`shiftDemoDates`). Their money has no
 * currency until it is read: each read is in the user's own currency
 * (`localizeDemoMoney`), so a change of regional format shows in the next demo.
 *
 * Every built-in template's words, demo or not, are in the language shown
 * when it is read (`translateTemplate`): its name and description in the
 * picker, and the project it makes. Saved templates stay as they were saved.
 */
export const BUILT_IN_TEMPLATES: readonly {
  id: string
  json: unknown
  demo?: { anchor: string }
}[] = Object.entries(TEMPLATE_SOURCES).map(([id, source]) => ({
  id,
  get json() {
    const json = translateTemplate(source)
    return DEMO_IDS.has(id) ? localizeDemoMoney(json) : json
  },
  ...(DEMO_ANCHORS[id] ? { demo: { anchor: DEMO_ANCHORS[id] } } : {})
}))
