-- Gate pass: the vehicle the goods crossed on.
--
-- Nullable, and deliberately so. The checker cannot always see a number - hand
-- carried goods, a courier that does not wait - and a mandatory field the gate
-- cannot answer is one the gate answers with "NA". Existing rows have no
-- vehicle recorded and none can be reconstructed, so they stay NULL rather
-- than being backfilled with a guess onto a document a dispute may turn on.
ALTER TABLE "gate_passes" ADD COLUMN "vehicle_no" VARCHAR(30);
