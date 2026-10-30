import type { Migration } from './types'

/**
 * N1.5, Weekly review (N13): finished reviews, and the reminder's weeks.
 *
 * `weekly_reviews` holds one row per finished review: when it finished and,
 * in `steps` (JSON), how many tasks each step showed and changed
 * (`WeeklyReviewStepCounts` in `src/shared/planning/weekly-review.ts`). A
 * review spans every project, so it has no `project_id` and does not travel
 * in a project file.
 *
 * `weekly_review_reminders` holds one row per reminder time the reminder
 * reached: `due_at` is the weekday and time it was set for (an instant),
 * `delivered_at` when Ostler noticed it, and `quiet` is 1 when it was never
 * shown (the setting was changed past it, or a review was already finished
 * that week). The Inbox shows the latest delivered, not quiet row until a
 * review finishes after it.
 */
export const weeklyReviews: Migration = {
  version: 23,
  name: 'weekly-reviews',
  up(db) {
    db.exec(`
      CREATE TABLE weekly_reviews (
        id TEXT PRIMARY KEY,
        finished_at INTEGER NOT NULL,
        steps TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_weekly_reviews_finished ON weekly_reviews(finished_at);
      CREATE TABLE weekly_review_reminders (
        due_at INTEGER PRIMARY KEY,
        delivered_at INTEGER NOT NULL,
        quiet INTEGER NOT NULL DEFAULT 0
      );
    `)
  }
}
