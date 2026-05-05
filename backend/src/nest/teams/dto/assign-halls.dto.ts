/**
 * @deprecated Removed by migration 20260505221345432_simplify-department-hall-1to1.
 *
 * Teams no longer have an own hall assignment. They inherit the hall from
 * their parent Department's `hall_id` column (1:1 model). To change a team's
 * hall, change the parent department's hall via PUT /departments/:id/hall.
 *
 * This file is kept empty so the path remains stable for git history.
 * It can be safely deleted in a follow-up cleanup PR.
 */
export {};
