-- A plan line carries ONE quantity, and the department says which.
--
--   Cutting    fabric, in metres          -> fabric_qty / fabric_uom
--   Stitching  cutting pieces             -> deliverable_size
--   Packing    produced product, pieces   -> deliverable_size
--   Dispatch   produced product, pieces   -> deliverable_size
--
-- `deliverable_size` becomes nullable because a cutting plan has none: what
-- goes to a cutting floor is cloth, and the pieces come back afterwards.
--
-- THE ORDER QUANTITY IS NO LONGER STORED ON THE LINE. The office reads the
-- column name "Deliverable Size" as the order total and was entering it on
-- every row, so a two-row plan against a 50,000 piece order allotted 100,000
-- and was refused. It is shown once at the head of the plan now, read from the
-- order line, and cannot be typed or double-counted.
--
-- Nothing is back-filled and nothing is dropped. Existing rows keep the
-- numbers they were written with.

ALTER TABLE "planning_lines" ALTER COLUMN "deliverable_size" DROP NOT NULL;
