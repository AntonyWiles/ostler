import { describe, expect, it } from 'vitest'
import {
  helpRoute,
  matchRoute,
  routeOwns,
  type AutomationRouteDef
} from '../../electron/services/automation/route-table'
import { HELP_ROUTES } from '../../electron/services/automation-http-server'

const handler = () => undefined
const route = (method: AutomationRouteDef['method'], path: string): AutomationRouteDef => ({
  method,
  path,
  description: path,
  response: '{ ok: true }',
  handler
})

const ROUTES = [
  route('GET', '/contacts'),
  route('PATCH', '/contacts/:contactId'),
  route('PATCH', '/fields/:fieldId'),
  route('PATCH', '/fields/reorder'),
  route('DELETE', '/work-items/:workItemId/contacts/:linkId')
]

describe('automation route table', () => {
  it('matches by method and segment count, a literal segment over a :param', () => {
    expect(matchRoute(ROUTES, 'PATCH', ['contacts', 'c1'])?.params).toEqual({ contactId: 'c1' })
    expect(matchRoute(ROUTES, 'GET', ['contacts', 'c1'])).toBeNull()
    expect(matchRoute(ROUTES, 'PATCH', ['fields', 'reorder'])?.route.path).toBe('/fields/reorder')
    expect(matchRoute(ROUTES, 'PATCH', ['fields', 'f1'])?.route.path).toBe('/fields/:fieldId')
  })

  it('owns every request under a handled route, whatever its method or length', () => {
    expect(routeOwns(ROUTES, ['contacts', 'c1', 'extra'])).toBe(true)
    expect(routeOwns(ROUTES, ['work-items', 'w1', 'contacts'])).toBe(true)
    expect(routeOwns(ROUTES, ['work-items', 'w1'])).toBe(false)
    expect(routeOwns(ROUTES, ['work-items', 'w1', 'comments'])).toBe(false)
    expect(routeOwns([{ ...route('GET', '/contacts'), handler: undefined }], ['contacts'])).toBe(
      false
    )
  })

  it('leaves the handler and body cap out of the help', () => {
    const help = helpRoute({ ...route('POST', '/days-off/import'), maxBodyBytes: 10 })
    expect(help).not.toHaveProperty('handler')
    expect(help).not.toHaveProperty('maxBodyBytes')
  })

  it('describes each method and path once', () => {
    const keys = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
