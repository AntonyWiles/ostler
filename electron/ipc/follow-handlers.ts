import type { FollowService } from '../services/follow-service'
import type Database from 'better-sqlite3'
import { handleApi } from './handle-ipc'
import { markProjectSeen, markTasksSeen, unseenTasks } from '../services/sync/task-unseen'

export interface FollowHandlerDependencies {
  followService: FollowService
  /** The planning database, which holds the per-device new and changed marks (MOP-82). */
  database: Database.Database
}

/** Following (prompt 15) and the new and changed marks (MOP-82): personal, so nothing here checks a role. */
export function registerFollowHandlers({ followService, database }: FollowHandlerDependencies) {
  handleApi('getUnseenTasks', async (_event, projectId: string) =>
    unseenTasks(database, String(projectId))
  )
  handleApi('markTasksSeen', async (_event, taskIds: string[]) => {
    if (!Array.isArray(taskIds)) throw new Error('Expected a list of task ids')
    markTasksSeen(
      database,
      taskIds.filter((id): id is string => typeof id === 'string')
    )
  })
  handleApi('markProjectTasksSeen', async (_event, projectId: string) =>
    markProjectSeen(database, String(projectId))
  )
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
