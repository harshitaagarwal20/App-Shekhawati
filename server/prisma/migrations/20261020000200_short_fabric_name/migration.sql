-- Rolls received before describeFabricName() carry the long slip description
-- as their name - "Fabric / 10 oz / 100% Cotton / 510 GSM / Natural" - which
-- repeats the roll's own content, GSM, count and colour columns and wraps
-- over five lines in every register. Drop the parts the roll already holds,
-- leaving "Fabric / 10 oz", the name new rolls are given.
--
-- Issues copy the roll's name when raised, so they are trimmed against the
-- same roll first, while the roll still holds the old name to match on.

CREATE FUNCTION pg_temp.short_fabric_name(name TEXT, content TEXT, gsm TEXT, cnt TEXT, colour TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(array_to_string(ARRAY(
    SELECT p FROM unnest(string_to_array(name, ' / ')) WITH ORDINALITY AS t(p, i)
    WHERE p NOT IN (COALESCE(content, ''), COALESCE(gsm, ''), COALESCE(cnt, ''), COALESCE(colour, ''))
    ORDER BY i
  ), ' / '), '')
$$;

UPDATE "fabric_issues" fi
SET "fabric_name" = pg_temp.short_fabric_name(fi."fabric_name", r."content", r."gsm", r."count", r."color_code")
FROM "fabric_rolls" r
WHERE fi."roll_id" = r."id"
  AND fi."fabric_name" = r."fabric_name"
  AND r."fabric_name" LIKE '% / % / %'
  AND pg_temp.short_fabric_name(r."fabric_name", r."content", r."gsm", r."count", r."color_code") IS NOT NULL;

UPDATE "fabric_rolls" r
SET "fabric_name" = pg_temp.short_fabric_name(r."fabric_name", r."content", r."gsm", r."count", r."color_code")
WHERE r."fabric_name" LIKE '% / % / %'
  AND pg_temp.short_fabric_name(r."fabric_name", r."content", r."gsm", r."count", r."color_code") IS NOT NULL;
