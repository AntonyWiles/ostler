/**
 * One filter model for every task view and the automation API (P5.7): a list
 * of conditions, all or any of which a task must meet. `matchesFilter` is the
 * only implementation: the Board, List, Calendar, Timeline, Home and
 * `GET /work-items?filter=` all call it, so a filter means the same thing
 * everywhere. `FIELD_SPECS` is the one description of the fields, their
 * operators and values; validation, the chips' words and the FilterBuilder
 * all read it.
 */

export * from './types'
export * from './specs'
export * from './match'
export * from './parse'
export * from './describe'
export * from './defaults'
