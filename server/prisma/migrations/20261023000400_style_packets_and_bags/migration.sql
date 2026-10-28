-- ===========================================================================
--  PHASE 6 - HOW A STYLE IS PACKED
-- ===========================================================================
--
--  One bag holds one piece, ten bags make a packet and ten packets a carton,
--  so a carton is 100 pieces - unless the style is packed otherwise. Packing
--  fills its pcs per box from packets x bags; Needle Checking and Packing show
--  each carton as packets and bags.
-- ===========================================================================

ALTER TABLE "styles"
  ADD COLUMN "bags_per_packet" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "packets_per_carton" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "styles"
  ADD CONSTRAINT "styles_bags_per_packet" CHECK ("bags_per_packet" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "styles_packets_per_carton" CHECK ("packets_per_carton" BETWEEN 1 AND 1000);
