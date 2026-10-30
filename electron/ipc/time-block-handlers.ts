import type {
  BlockMovePlan,
  CreateTimeBlockInput,
  FillDayPlan,
  TimeBlock,
  TimeBlocksQuery,
  UpdateTimeBlockInput
} from '@shared/ostler-api'
import type { BlockMoveService } from '../services/block-move-service'
import type { TimeBlockService } from '../services/time-block-service'
import type { ApiArgs, ApiInvokeMethod, ApiValue } from '@shared/ostler-api/api-channels'
import { handleApi } from './handle-ipc'

export interface TimeBlockHandlerDependencies {
  timeBlockService: TimeBlockService
  blockMoveService: BlockMoveService
  /** Home's My day shows today's blocks. */
  notifyHomeChanged(): void
}

/**
 * Time blocks (N3.4a). The service checks every id, date and time and that
 * the task's project is enabled, the same as for the automation API; each
 * change marks the task's project changed, so its views refresh.
 */
export function registerTimeBlockHandlers({
  timeBlockService,
  blockMoveService,
  notifyHomeChanged
}: TimeBlockHandlerDependencies): void {
  const mutating = <M extends ApiInvokeMethod>(
    method: M,
    handler: (...args: ApiArgs<M>) => ApiValue<M> | Promise<ApiValue<M>>
  ) =>
    handleApi(method, async (_event, ...args) => {
      const result = handler(...args)
      notifyHomeChanged()
      return result
    })

  handleApi('getTimeBlocks', async (_event, query: TimeBlocksQuery) => timeBlockService.list(query))
  mutating('createTimeBlock', (input: CreateTimeBlockInput) => timeBlockService.create(input))
  mutating('updateTimeBlock', (blockId: string, updates: UpdateTimeBlockInput) =>
    timeBlockService.update(blockId, updates)
  )
  mutating('removeTimeBlock', (blockId: string) => timeBlockService.remove(blockId))
  mutating('restoreTimeBlock', (block: TimeBlock) => timeBlockService.restore(block))
  mutating('removeTimeBlocks', (blockIds: string[]) => timeBlockService.removeMany(blockIds))
  // Blocks that move (N3.4b): previews change nothing; each apply is the person's click.
  handleApi('previewBlockMoves', async (_event, blockIds: string[]) =>
    blockMoveService.planMoves(blockIds)
  )
  mutating('applyBlockMoves', (plan: BlockMovePlan) => blockMoveService.applyMoves(plan))
  handleApi('previewFillDay', async (_event, date: string) => blockMoveService.planFill(date))
  mutating('applyFillDay', (plan: FillDayPlan) => blockMoveService.applyFill(plan))
}
