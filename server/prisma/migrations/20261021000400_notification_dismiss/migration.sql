-- ===========================================================================
--  DISMISSING A NOTIFICATION
-- ===========================================================================
--
--  The bell kept every notification forever: reading one only cleared its
--  dot. Its owner can now clear it from the panel - one at a time, or every
--  read one at once.
--
--    notifications.dismissed_at   set when cleared; the bell lists only rows
--                                 where it is null.
--
--  A soft flag rather than a DELETE: the (user_id, dedupe_key) unique index is
--  what makes a replayed approval event or a re-run daily summary a no-op,
--  and it can only do that while the row is still there.
-- ===========================================================================

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dismissed_at" TIMESTAMPTZ(3);
