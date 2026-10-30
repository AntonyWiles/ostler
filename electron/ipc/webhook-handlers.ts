import {
  type AddWebhookInput,
  type UpdateWebhookInput,
  type WatchedProject
} from '@shared/ostler-api'
import type { WebhookService } from '../services/webhook-service'
import { handleApi } from './handle-ipc'

/**
 * Telling the team (integrations phase 4): Project settings › Sharing ›
 * Tell the team. The address comes in to add or replace a webhook and is
 * never sent back; the project must be one Ostler knows.
 */
export function registerWebhookHandlers(
  webhooks: WebhookService,
  getProject: (projectId: string) => WatchedProject
): void {
  handleApi('listWebhooks', (_event, projectId: string) => webhooks.list(getProject(projectId).id))
  handleApi('addWebhook', (_event, input: AddWebhookInput) =>
    webhooks.add({ ...input, projectId: getProject(input?.projectId).id })
  )
  handleApi('updateWebhook', (_event, id: string, input: UpdateWebhookInput) =>
    webhooks.update(id, input)
  )
  handleApi('removeWebhook', (_event, id: string) => webhooks.remove(id))
  handleApi('testWebhook', (_event, id: string) => webhooks.test(id))
}
