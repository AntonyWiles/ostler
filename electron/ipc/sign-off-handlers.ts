import { type RequestSignOffInput, type SignOffItem } from '@shared/ostler-api'
import type { SignOffService } from '../services/sign-off-service'
import { handleApi } from './handle-ipc'

export interface SignOffHandlerDependencies {
  signOffService: SignOffService
  notifyPlanningChanged: (projectId: string) => void
}

/** Sign-offs (prompt 16): the role and approver checks are in `SignOffService`, in the main process. */
export function registerSignOffHandlers({
  signOffService,
  notifyPlanningChanged
}: SignOffHandlerDependencies) {
  handleApi('listSignOffsForItem', async (_event, item: SignOffItem) =>
    signOffService.forItem(item)
  )
  handleApi('requestSignOff', async (_event, input: RequestSignOffInput) => {
    const created = signOffService.request(input)
    notifyPlanningChanged(created.projectId)
    return created
  })
  handleApi('approveSignOff', async (_event, id: string) => {
    const answered = signOffService.approve(id)
    notifyPlanningChanged(answered.projectId)
    return answered
  })
  handleApi('sendBackSignOff', async (_event, id: string, note: string) => {
    const answered = signOffService.sendBack(id, note)
    notifyPlanningChanged(answered.projectId)
    return answered
  })
  handleApi('cancelSignOff', async (_event, id: string) => {
    signOffService.cancel(id)
  })
  handleApi('listSignOffsForProject', async (_event, projectId: string) =>
    signOffService.forProject(projectId)
  )
  handleApi('listSignOffsWaitingForMe', async () => signOffService.waitingForMe())
}
