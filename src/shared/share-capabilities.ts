/**
 * What this version of Ostler understands about shared projects beyond what every version did.
 * Each PC in a shared project advertises this list (electron/services/sync/capabilities.ts), and
 * a newer feature is offered only when every member's PC lists it, so an older Ostler is never
 * handed something it would read differently.
 *
 * Bump `CAPABILITIES_VERSION` whenever the list grows: the list is written once per version.
 */
export const MY_SHARE_CAPABILITIES = ['contributor-role', 'editor-invites', 'invite-reset'] as const

export type ShareCapability = (typeof MY_SHARE_CAPABILITIES)[number]

export const CAPABILITIES_VERSION = 3
