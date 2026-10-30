import type { FollowService } from '../services/follow-service'
import { handleApi } from './handle-ipc'

export interface FollowHandlerDependencies {
  followService: FollowService
}

/** Following (prompt 15): personal, so nothing here checks a role. */
export function registerFollowHandlers({ followService }: FollowHandlerDependencies) {
  handleApi('getTaskFollow', async (_event, taskId: string) => followService.isFollowing(taskId))
  handleApi(
    'setTaskFollow',
    async (_event, projectId: string, taskId: string, following: boolean) => {
      if (following) followService.follow(projectId, taskId)
      else followService.unfollow(projectId, taskId)
      return following
    }
  )
}
