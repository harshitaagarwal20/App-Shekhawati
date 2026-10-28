-- The ColorCode list had both "Mid Night Blue" and "Midnight Blue". Retire
-- the former spelling so new documents choose one value. Existing documents
-- keep their original text; inventory resolution maps it to Midnight Blue.
UPDATE "master_list_values" AS v
   SET "is_active" = FALSE,
       "deleted_at" = COALESCE(v."deleted_at", CURRENT_TIMESTAMP),
       "updated_at" = CURRENT_TIMESTAMP
  FROM "master_lists" AS l
 WHERE v."list_id" = l."id"
   AND l."code" = 'ColorCode'
   AND v."value" = 'Mid Night Blue'
   AND v."deleted_at" IS NULL;
