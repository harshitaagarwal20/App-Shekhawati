/**
 * Transaction sample data, seeded from "Shekwati Impex formats.xlsx"
 * (and the "Dyeing Receipt" sheet of "Shekwati4.xlsx").
 *
 * The workbook README notes: "7 sample rows per sheet, cross-linked on Order No
 * / Style No / Fabric No / PO ID so end-to-end testing works. Delete before
 * go-live." The same rows are reproduced here so the ERP can be walked
 * end-to-end and reconciled against the workbook.
 */

/** Order sheet - rows 7..13. excessPct is the "Excess" column (a fraction). */
export const buyerOrders = [
  { orderNo: 'B9641IS', orderDate: '2026-08-06', itemDescription: 'Tote Bag - Long Handle Canvas', buyerName: 'Trade Word', billTo: 'Trade Word, New York', shipTo: 'Trade Word DC, New Jersey', buyerDeliveryDate: '2026-09-01', orderQty: '5000', styleNo: 'TR-0751-008', colorCode: 'Natural', currency: 'USD', shipMode: 'Ship', sizeGroup: 'Free Size', status: 'IN_PROGRESS', remarks: 'First shipment of season', excessPct: '0.02' },
  { orderNo: 'B9646IS', orderDate: '2026-08-07', itemDescription: 'Tote Bag - Short Handle', buyerName: 'Trade Word', billTo: 'Trade Word, New York', shipTo: 'Trade Word DC, New Jersey', buyerDeliveryDate: '2026-09-10', orderQty: '7000', styleNo: 'TR-0751-009', colorCode: 'Night Black', currency: 'USD', shipMode: 'Ship', sizeGroup: 'Free Size', status: 'IN_PROGRESS', remarks: null, excessPct: '0.02' },
  { orderNo: 'B9652IS', orderDate: '2026-08-10', itemDescription: 'Shopper Bag - Gusset', buyerName: 'Global Bags Ltd', billTo: 'Global Bags, London', shipTo: 'Global Bags DC, Tilbury', buyerDeliveryDate: '2026-09-20', orderQty: '4000', styleNo: 'TR-0752-101', colorCode: 'Olive Green', currency: 'GBP', shipMode: 'Ship', sizeGroup: 'Large', status: 'IN_PROGRESS', remarks: 'Base board required', excessPct: '0.03' },
  { orderNo: 'B9658IS', orderDate: '2026-08-12', itemDescription: 'Purse Basic - Zip Top', buyerName: 'EcoCarry BV', billTo: 'EcoCarry, Amsterdam', shipTo: 'Rotterdam Port', buyerDeliveryDate: '2026-09-25', orderQty: '10000', styleNo: 'PU-0330-045', colorCode: 'Off White', currency: 'EUR', shipMode: 'Ship', sizeGroup: 'Small', status: 'PENDING', remarks: null, excessPct: '0.02' },
  { orderNo: 'B9663IS', orderDate: '2026-08-14', itemDescription: 'Tote Bag - Printed Panel', buyerName: 'Urban Tote Inc', billTo: 'Urban Tote, SF', shipTo: 'Oakland DC', buyerDeliveryDate: '2026-10-05', orderQty: '6000', styleNo: 'TB-0910-012', colorCode: 'Navy Blue', currency: 'USD', shipMode: 'Air', sizeGroup: 'Medium', status: 'PENDING', remarks: 'Print before stitching', excessPct: '0.02' },
  { orderNo: 'B9670IS', orderDate: '2026-08-18', itemDescription: 'Basic Bag - Jute Handle', buyerName: 'Nordic Sacks AB', billTo: 'Nordic Sacks, Sthlm', shipTo: 'Stockholm DC', buyerDeliveryDate: '2026-10-15', orderQty: '3500', styleNo: 'BS-0455-003', colorCode: 'Khaki', currency: 'EUR', shipMode: 'Ship', sizeGroup: 'Free Size', status: 'PENDING', remarks: null, excessPct: '0.03' },
  { orderNo: 'B9675IS', orderDate: '2026-08-20', itemDescription: 'Purse Basic - Flap', buyerName: 'EcoCarry BV', billTo: 'EcoCarry, Amsterdam', shipTo: 'Rotterdam Port', buyerDeliveryDate: '2026-10-20', orderQty: '8000', styleNo: 'PU-0330-046', colorCode: 'Burgundy', currency: 'EUR', shipMode: 'Ship', sizeGroup: 'Small', status: 'PENDING', remarks: null, excessPct: '0.02' },
];

/**
 * Planning sheet - rows 7..13, grouped into one Cutting plan per order.
 * "Cutting Pcs alloted" is only filled for B9641IS in the workbook.
 * deliverableSize is the day-wise piece allotment that the "Planning_" header
 * sheet asks for; it is taken from the lot sizes the Cutting Issue sheet
 * actually issues against each order (2500 / 3500 / 2000 / 5000 / 3000).
 */
export const plannings = [
  {
    orderNo: 'B9641IS', planDepartment: 'CUTTING', containerNo: 'CN-91', planDate: '2026-08-12',
    status: 'IN_PROGRESS', remarks: 'Cut in 2 lots', approvalStatus: 'APPROVED', version: 1,
    lines: [
      { lineDate: '2026-08-12', unit: 'Unit 1 - Anil Kumar', deliverableSize: '2500', cuttingPcsAllotted: '212', status: 'COMPLETED', remark: 'Cut in 2 lots' },
      { lineDate: '2026-08-17', unit: 'Unit 1 - Anil Kumar', deliverableSize: '2500', cuttingPcsAllotted: '246', status: 'IN_PROGRESS', remark: '2500 pcs/day' },
    ],
  },
  {
    orderNo: 'B9646IS', planDepartment: 'CUTTING', containerNo: 'CN-92', planDate: '2026-08-16',
    status: 'IN_PROGRESS', remarks: null, approvalStatus: 'APPROVED', version: 1,
    lines: [
      { lineDate: '2026-08-16', unit: 'Unit 2 - Mahipal', deliverableSize: '3500', cuttingPcsAllotted: null, status: 'COMPLETED', remark: null },
      { lineDate: '2026-08-20', unit: 'Unit 2 - Mahipal', deliverableSize: '3500', cuttingPcsAllotted: null, status: 'IN_PROGRESS', remark: null },
    ],
  },
  {
    orderNo: 'B9652IS', planDepartment: 'CUTTING', containerNo: 'CN-93', planDate: '2026-08-18',
    status: 'IN_PROGRESS', remarks: 'Gusset adds time', approvalStatus: 'APPROVED', version: 2,
    lines: [
      { lineDate: '2026-08-18', unit: 'Unit 3 - Ramesh', deliverableSize: '2000', cuttingPcsAllotted: null, status: 'IN_PROGRESS', remark: 'Gusset adds time' },
      { lineDate: '2026-08-21', unit: 'Unit 4 - Suresh', deliverableSize: '2000', cuttingPcsAllotted: null, status: 'PENDING', remark: 'Shifted from Unit 3 after rejection' },
    ],
  },
  {
    orderNo: 'B9658IS', planDepartment: 'CUTTING', containerNo: 'CN-94', planDate: '2026-08-22',
    status: 'PENDING', remarks: 'High volume - split lots', approvalStatus: 'APPROVED', version: 2,
    lines: [
      { lineDate: '2026-08-22', unit: 'Unit 4 - Suresh', deliverableSize: '5000', cuttingPcsAllotted: null, status: 'PENDING', remark: 'Lot 1 of 2' },
      { lineDate: '2026-08-26', unit: 'Unit 4 - Suresh', deliverableSize: '5000', cuttingPcsAllotted: null, status: 'PENDING', remark: 'Lot 2 of 2 - cutting extended by 3 days' },
    ],
  },
  {
    orderNo: 'B9663IS', planDepartment: 'CUTTING', containerNo: 'CN-95', planDate: '2026-08-25',
    status: 'PENDING', remarks: 'Air shipment', approvalStatus: 'PENDING', version: 1,
    lines: [
      { lineDate: '2026-08-25', unit: 'Unit 1 - Anil Kumar', deliverableSize: '3000', cuttingPcsAllotted: null, status: 'PENDING', remark: 'Printed panels' },
      { lineDate: '2026-08-29', unit: 'Unit 1 - Anil Kumar', deliverableSize: '3000', cuttingPcsAllotted: null, status: 'PENDING', remark: null },
    ],
  },
];

/** Vendor Quotation-Approval sheet - rows 7..13. Amount = Rate x Qty. */
export const vendorQuotations = [
  { quotationNo: 'QT-001', quotationDate: '2026-08-04', item: 'Fabric', subCategory: '10 oz', vendorName: 'Rajasthan Fabrics', rateQuoted: '178', uom: 'Mtrs', qty: '4500', authorisedBy: 'Dinesh Sir', authorisationStatus: 'APPROVED', remarks: 'Lowest of 3 quotes', orderNo: 'B9641IS' },
  { quotationNo: 'QT-002', quotationDate: '2026-08-04', item: 'Fabric', subCategory: '10 oz', vendorName: 'Shilpa Tex', rateQuoted: '186', uom: 'Mtrs', qty: '4500', authorisedBy: 'Dinesh Sir', authorisationStatus: 'REJECTED', remarks: 'Rate higher', orderNo: 'B9641IS' },
  { quotationNo: 'QT-003', quotationDate: '2026-08-05', item: 'Accessories', accessoriesItem: 'Cotton Handle', vendorName: 'Metro Accessories', rateQuoted: '12', uom: 'Pcs', qty: '9000', authorisedBy: 'Dinesh Sir', authorisationStatus: 'APPROVED', remarks: 'Cotton handles', orderNo: 'B9641IS' },
  { quotationNo: 'QT-004', quotationDate: '2026-08-08', item: 'Fabric', subCategory: '12 oz', vendorName: 'Rajasthan Fabrics', rateQuoted: '182', uom: 'Mtrs', qty: '6200', authorisedBy: 'Dinesh Sir', authorisationStatus: 'APPROVED', remarks: 'For B9646IS', orderNo: 'B9646IS' },
  { quotationNo: 'QT-005', quotationDate: '2026-08-09', item: 'Accessories', accessoriesItem: 'Zipper', vendorName: 'Metro Accessories', rateQuoted: '4', uom: 'Pcs', qty: '12000', authorisedBy: 'Dinesh Sir', authorisationStatus: 'PENDING', remarks: 'Zippers - awaiting sample', orderNo: 'B9658IS' },
  { quotationNo: 'QT-006', quotationDate: '2026-08-11', item: 'Fabric', subCategory: '10 oz', vendorName: 'Rajasthan Fabrics', rateQuoted: '165', uom: 'Mtrs', qty: '3400', authorisedBy: 'Dinesh Sir', authorisationStatus: 'APPROVED', remarks: 'Recycled cotton', orderNo: 'B9658IS' },
  { quotationNo: 'QT-007', quotationDate: '2026-08-13', item: 'Label', accessoriesItem: 'Woven Label', vendorName: 'Metro Accessories', rateQuoted: '3', uom: 'Pcs', qty: '20000', authorisedBy: 'Dinesh Sir', authorisationStatus: 'APPROVED', remarks: 'Woven labels', orderNo: 'B9646IS' },
];

/**
 * PO sheet - rows 7..13. Amount = Order Qty x Rate.
 * orderMode is read out of the Remarks column, which is where the workbook
 * records it ("Order as per Style - B9641IS" / "Bulk Order - B9646IS").
 */
export const purchaseOrders = [
  { poId: 'RF-001', poDate: '2026-08-05', item: 'Fabric', subCategory: '10 oz', accessoriesItem: null, excessAllowed: '0.02', vendorName: 'Rajasthan Fabrics', address: 'RIICO Area, Jaipur', uom: 'Mtrs', orderQty: '4500', rate: '178', hsnCode: '52081290', gsm: '320 GSM', content: '100% Cotton', colorCode: 'Natural', count: '10x6', status: 'COMPLETED', remarks: 'Order as per Style - B9641IS', orderMode: 'AS_PER_STYLE', orderNo: 'B9641IS', styleNo: 'TR-0751-008', quotationNo: 'QT-001', approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-05' },
  { poId: 'RF-002', poDate: '2026-08-08', item: 'Fabric', subCategory: '12 oz', accessoriesItem: null, excessAllowed: '0.02', vendorName: 'Rajasthan Fabrics', address: 'RIICO Area, Jaipur', uom: 'Mtrs', orderQty: '6200', rate: '182', hsnCode: '52081290', gsm: '340 GSM', content: '100% Cotton', colorCode: 'Night Black', count: '12x12', status: 'COMPLETED', remarks: 'Bulk Order - B9646IS', orderMode: 'BULK', orderNo: 'B9646IS', styleNo: 'TR-0751-009', quotationNo: 'QT-004', approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-08' },
  { poId: 'MA-001', poDate: '2026-08-09', item: 'Accessories', subCategory: null, accessoriesItem: 'Cotton Handle', excessAllowed: '0.01', vendorName: 'Metro Accessories', address: 'Johri Bazar, Jaipur', uom: 'Pcs', orderQty: '9000', rate: '12', hsnCode: '63079090', gsm: null, content: null, colorCode: 'Natural', count: null, status: 'COMPLETED', remarks: '1% excess allowed', orderMode: 'AS_PER_STYLE', orderNo: 'B9641IS', styleNo: 'TR-0751-008', quotationNo: 'QT-003', approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-09' },
  { poId: 'RF-003', poDate: '2026-08-11', item: 'Fabric', subCategory: '10 oz', accessoriesItem: null, excessAllowed: '0.03', vendorName: 'Rajasthan Fabrics', address: 'RIICO Area, Jaipur', uom: 'Mtrs', orderQty: '3400', rate: '165', hsnCode: '52081290', gsm: '280 GSM', content: 'Recycled Cotton', colorCode: 'Off White', count: '10x6', status: 'IN_PROGRESS', remarks: 'For B9658IS purses', orderMode: 'AS_PER_STYLE', orderNo: 'B9658IS', styleNo: 'PU-0330-045', quotationNo: 'QT-006', approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-11' },
  { poId: 'MA-002', poDate: '2026-08-13', item: 'Accessories', subCategory: null, accessoriesItem: 'Woven Label', excessAllowed: '0.01', vendorName: 'Metro Accessories', address: 'Johri Bazar, Jaipur', uom: 'Pcs', orderQty: '20000', rate: '3', hsnCode: '58071010', gsm: null, content: null, colorCode: null, count: null, status: 'IN_PROGRESS', remarks: 'Buyer branded', orderMode: 'AS_PER_STYLE', orderNo: 'B9646IS', styleNo: 'TR-0751-009', quotationNo: 'QT-007', approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-13' },
  { poId: 'RF-004', poDate: '2026-08-15', item: 'Fabric', subCategory: '12 oz', accessoriesItem: null, excessAllowed: '0.02', vendorName: 'Rajasthan Fabrics', address: 'RIICO Area, Jaipur', uom: 'Mtrs', orderQty: '5600', rate: '188', hsnCode: '52081290', gsm: '340 GSM', content: 'Cotton-Poly 80:20', colorCode: 'Navy Blue', count: '12x12', status: 'PENDING', remarks: 'Bulk Order - B9663IS', orderMode: 'BULK', orderNo: 'B9663IS', styleNo: 'TB-0910-012', quotationNo: null, approvalStatus: 'APPROVED', approvedByName: 'Dinesh Sir', approvedAt: '2026-08-15' },
  { poId: 'MA-003', poDate: '2026-08-16', item: 'Accessories', subCategory: null, accessoriesItem: 'Zipper', excessAllowed: '0.01', vendorName: 'Metro Accessories', address: 'Johri Bazar, Jaipur', uom: 'Pcs', orderQty: '12000', rate: '4', hsnCode: '96071110', gsm: null, content: null, colorCode: 'Off White', count: null, status: 'PENDING', remarks: 'Awaiting quote approval', orderMode: 'AS_PER_STYLE', orderNo: 'B9658IS', styleNo: 'PU-0330-045', quotationNo: 'QT-005', approvalStatus: 'PENDING', approvedByName: null, approvedAt: null },
];

/**
 * Gate Pass sheet - rows 7..13.
 * Variation % = IFERROR((Qty - Received Qty)/Qty, 0)
 */
export const gatePasses = [
  { gatePassNo: 'GP-001', gatePassDate: '2026-08-09', type: 'INWARD', linkedDocNo: 'RF-001', item: 'Fabric', partyName: 'Rajasthan Fabrics', qty: '4500', receivedQty: '4500', uom: 'Mtrs', purpose: 'OTHER', authorisedBy: 'Ravi Prajapat', status: 'CLEARED', remarks: 'Against PO RF-001' },
  { gatePassNo: 'GP-002', gatePassDate: '2026-08-10', type: 'OUTWARD', linkedDocNo: 'DY-001', item: 'Fabric', partyName: 'Shilpa Tex', qty: '2000', receivedQty: '2000', uom: 'Mtrs', purpose: 'DYEING', authorisedBy: 'Dinesh Sir', status: 'CLEARED', remarks: 'Sent for dyeing' },
  { gatePassNo: 'GP-003', gatePassDate: '2026-08-14', type: 'INWARD', linkedDocNo: 'DY-001', item: 'Dyed Fabric', partyName: 'Shilpa Tex', qty: '2000', receivedQty: '1950', uom: 'Mtrs', purpose: 'DYEING', authorisedBy: 'Ravi Prajapat', status: 'CLEARED', remarks: '2.5% shrinkage' },
  { gatePassNo: 'GP-004', gatePassDate: '2026-08-15', type: 'OUTWARD', linkedDocNo: 'PR-001', item: 'Cut Panels', partyName: 'Bagru Prints', qty: '3000', receivedQty: '3000', uom: 'Pcs', purpose: 'PRINTING', authorisedBy: 'Dinesh Sir', status: 'CLEARED', remarks: 'Print before stitching' },
  { gatePassNo: 'GP-005', gatePassDate: '2026-08-17', type: 'OUTWARD', linkedDocNo: 'CH-001', item: 'Cutting Pieces', partyName: 'Anil Kumar Stitching', qty: '2500', receivedQty: '2500', uom: 'Pcs', purpose: 'STITCHING', authorisedBy: 'Ravi Prajapat', status: 'CLEARED', remarks: 'Unit 1 allotment' },
  { gatePassNo: 'GP-006', gatePassDate: '2026-08-19', type: 'INWARD', linkedDocNo: 'CH-001', item: 'Cutting Pieces', partyName: 'Anil Kumar Stitching', qty: '2500', receivedQty: '2460', uom: 'Pcs', purpose: 'STITCHING', authorisedBy: 'Ravi Prajapat', status: 'CLEARED', remarks: '40 pcs held for alteration' },
  { gatePassNo: 'GP-007', gatePassDate: '2026-08-21', type: 'INWARD', linkedDocNo: 'MA-003', item: 'Zipper', partyName: 'Metro Accessories', qty: '12000', receivedQty: '12000', uom: 'Pcs', purpose: 'OTHER', authorisedBy: 'Ravi Prajapat', status: 'PENDING', remarks: 'Awaiting QC count' },
];

/** GRN sheet - rows 7..13. Amount = Receiving Qty x Inventory Rate. */
export const grns = [
  { grnNo: 'GRN-001', poId: 'RF-001', billNo: 'BL-1201', grnDate: '2026-08-09', purpose: 'RAW_MATERIAL', item: 'Fabric', hsnCode: '52081290', uom: 'Mtrs', orderQty: '4500', receivingQty: '4500', inventoryRate: '178', status: 'COMPLETED', remarks: 'Full qty received', gatePassNo: 'GP-001' },
  { grnNo: 'GRN-002', poId: 'RF-002', billNo: 'BL-1215', grnDate: '2026-08-12', purpose: 'RAW_MATERIAL', item: 'Fabric', hsnCode: '52081290', uom: 'Mtrs', orderQty: '6200', receivingQty: '6180', inventoryRate: '182', status: 'COMPLETED', remarks: '20 mtrs short', gatePassNo: null },
  { grnNo: 'GRN-003', poId: 'MA-001', billNo: 'MA-0450', grnDate: '2026-08-13', purpose: 'ACCESSORIES', item: 'Accessories', hsnCode: '63079090', uom: 'Pcs', orderQty: '9000', receivingQty: '9090', inventoryRate: '12', status: 'COMPLETED', remarks: 'Cotton Handle - 1% excess received', gatePassNo: null },
  { grnNo: 'GRN-004', poId: 'RF-003', billNo: 'BL-1233', grnDate: '2026-08-16', purpose: 'RAW_MATERIAL', item: 'Fabric', hsnCode: '52081290', uom: 'Mtrs', orderQty: '3400', receivingQty: '3400', inventoryRate: '165', status: 'COMPLETED', remarks: null, gatePassNo: null },
  { grnNo: 'GRN-005', poId: 'MA-002', billNo: 'MA-0461', grnDate: '2026-08-18', purpose: 'ACCESSORIES', item: 'Accessories', hsnCode: '58071010', uom: 'Pcs', orderQty: '20000', receivingQty: '20000', inventoryRate: '3', status: 'COMPLETED', remarks: 'Woven Label - buyer branded', gatePassNo: null },
  { grnNo: 'GRN-006', poId: 'RF-004', billNo: 'BL-1247', grnDate: '2026-08-20', purpose: 'RAW_MATERIAL', item: 'Fabric', hsnCode: '52081290', uom: 'Mtrs', orderQty: '5600', receivingQty: '2800', inventoryRate: '188', status: 'IN_PROGRESS', remarks: 'Partial - balance in transit', gatePassNo: null },
  { grnNo: 'GRN-007', poId: 'MA-003', billNo: 'MA-0470', grnDate: '2026-08-22', purpose: 'ACCESSORIES', item: 'Zipper', hsnCode: '96071110', uom: 'Pcs', orderQty: '12000', receivingQty: '12000', inventoryRate: '4', status: 'COMPLETED', remarks: null, gatePassNo: 'GP-007' },
];

/**
 * Fabric rolls FAB-001..FAB-010.
 *
 * The workbook's GRN "Roll No" column is blank in every sample row, so the
 * roll-to-GRN link below is INFERRED by matching each roll's fabric attributes
 * (as printed on the Fabric Issue and Dye issue sheets) to the GRN that bought
 * that fabric. Rolls whose attributes match no sample GRN (FAB-005, FAB-007,
 * FAB-008, FAB-010) are seeded with no GRN link.
 */
export const fabricRolls = [
  { rollNo: 'FAB-001', grnNo: 'GRN-001', vendorName: 'Rajasthan Fabrics', fabricName: '10 oz 10x6', colorCode: 'Natural', content: '100% Cotton', count: '10x6', construction: '76x28', width: '63', gsm: '320 GSM', uom: 'Mtrs', receivedQty: '2000', rate: '178', stage: 'DYED' },
  { rollNo: 'FAB-002', grnNo: 'GRN-001', vendorName: 'Rajasthan Fabrics', fabricName: '10 oz 10x6', colorCode: 'Natural', content: '100% Cotton', count: '10x6', construction: '76x28', width: '63', gsm: '320 GSM', uom: 'Mtrs', receivedQty: '1950', rate: '178', stage: 'ISSUED_TO_CUTTING' },
  { rollNo: 'FAB-003', grnNo: 'GRN-006', vendorName: 'Rajasthan Fabrics', fabricName: '12 oz 12x12', colorCode: 'Navy Blue', content: 'Cotton-Poly 80:20', count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', uom: 'Mtrs', receivedQty: '1200', rate: '188', stage: 'ISSUED_FOR_PRINTING' },
  { rollNo: 'FAB-004', grnNo: 'GRN-002', vendorName: 'Rajasthan Fabrics', fabricName: '12 oz 12x12', colorCode: 'Night Black', content: '100% Cotton', count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', uom: 'Mtrs', receivedQty: '3000', rate: '182', stage: 'DYED' },
  { rollNo: 'FAB-005', grnNo: null, vendorName: 'Rajasthan Fabrics', fabricName: '10 oz 10x6', colorCode: 'Olive Green', content: 'Canvas Cotton', count: '10x6', construction: '76x28', width: '60', gsm: '280 GSM', uom: 'Mtrs', receivedQty: '2200', rate: '175', stage: 'SCRUTINY_HOLD' },
  { rollNo: 'FAB-006', grnNo: 'GRN-004', vendorName: 'Rajasthan Fabrics', fabricName: '10 oz 10x6', colorCode: 'Off White', content: 'Recycled Cotton', count: '10x6', construction: '48x28', width: '58', gsm: '260 GSM', uom: 'Mtrs', receivedQty: '1500', rate: '165', stage: 'DYED' },
  { rollNo: 'FAB-007', grnNo: null, vendorName: 'Rajasthan Fabrics', fabricName: 'Jute Canvas', colorCode: 'Khaki', content: '100% Jute', count: '8x4', construction: '68x38', width: '60', gsm: '400 GSM', uom: 'Mtrs', receivedQty: '1100', rate: '150', stage: 'ISSUED_FOR_PRINTING' },
  { rollNo: 'FAB-008', grnNo: null, vendorName: 'Rajasthan Fabrics', fabricName: '10 oz 10x6', colorCode: 'Burgundy', content: 'Recycled Cotton', count: '10x6', construction: '48x28', width: '58', gsm: '260 GSM', uom: 'Mtrs', receivedQty: '1800', rate: '165', stage: 'DYED' },
  { rollNo: 'FAB-009', grnNo: 'GRN-006', vendorName: 'Rajasthan Fabrics', fabricName: '12 oz 12x12', colorCode: 'Navy Blue', content: 'Cotton-Poly 80:20', count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', uom: 'Mtrs', receivedQty: '2500', rate: '188', stage: 'SCRUTINY_HOLD' },
  { rollNo: 'FAB-010', grnNo: null, vendorName: 'Rajasthan Fabrics', fabricName: 'Jute Canvas', colorCode: 'Khaki', content: '100% Jute', count: '8x4', construction: '68x38', width: '60', gsm: '400 GSM', uom: 'Mtrs', receivedQty: '1600', rate: '150', stage: 'DYED' },
];

/** Fabric Issue sheet - rows 7..16. Issuer is always Maharaj Singh (EMP-001). */
export const fabricIssues = [
  { issueNo: 'FI-001', issueDate: '2026-08-10', rollNo: 'FAB-001', purpose: 'DYEING',   orderNo: 'B9641IS', styleNo: 'TR-0751-008', issuedByName: 'Maharaj Singh', fabricQtyIssued: '2000', fabricName: '10 oz 10x6', colorCode: 'Natural',     status: 'COMPLETED',   remarks: 'Sent to Shilpa Tex', vendorName: 'Shilpa Tex' },
  { issueNo: 'FI-002', issueDate: '2026-08-14', rollNo: 'FAB-002', purpose: 'CUTTING',  orderNo: 'B9641IS', styleNo: 'TR-0751-008', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1950', fabricName: '10 oz 10x6', colorCode: 'Natural',     status: 'COMPLETED',   remarks: 'Post dyeing', vendorName: null },
  { issueNo: 'FI-003', issueDate: '2026-08-15', rollNo: 'FAB-003', purpose: 'PRINTING', orderNo: 'B9663IS', styleNo: 'TB-0910-012', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1200', fabricName: '12 oz 12x12', colorCode: 'Navy Blue',   status: 'IN_PROGRESS', remarks: 'Panel print', vendorName: 'Bagru Prints' },
  { issueNo: 'FI-004', issueDate: '2026-08-16', rollNo: 'FAB-004', purpose: 'CUTTING',  orderNo: 'B9646IS', styleNo: 'TR-0751-009', issuedByName: 'Maharaj Singh', fabricQtyIssued: '3000', fabricName: '12 oz 12x12', colorCode: 'Night Black', status: 'COMPLETED',   remarks: null, vendorName: null },
  { issueNo: 'FI-005', issueDate: '2026-08-18', rollNo: 'FAB-005', purpose: 'CUTTING',  orderNo: 'B9652IS', styleNo: 'TR-0752-101', issuedByName: 'Maharaj Singh', fabricQtyIssued: '2200', fabricName: '10 oz 10x6', colorCode: 'Olive Green', status: 'COMPLETED',   remarks: 'Gusset panels', vendorName: null },
  { issueNo: 'FI-006', issueDate: '2026-08-19', rollNo: 'FAB-006', purpose: 'DYEING',   orderNo: 'B9658IS', styleNo: 'PU-0330-045', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1500', fabricName: '10 oz 10x6', colorCode: 'Off White',   status: 'IN_PROGRESS', remarks: null, vendorName: 'Shilpa Tex' },
  { issueNo: 'FI-007', issueDate: '2026-08-21', rollNo: 'FAB-007', purpose: 'CUTTING',  orderNo: 'B9670IS', styleNo: 'BS-0455-003', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1100', fabricName: 'Jute Canvas', colorCode: 'Khaki',       status: 'PENDING',     remarks: null, vendorName: null },
  { issueNo: 'FI-008', issueDate: '2026-08-23', rollNo: 'FAB-008', purpose: 'DYEING',   orderNo: 'B9675IS', styleNo: 'PU-0330-046', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1800', fabricName: '10 oz 10x6', colorCode: 'Burgundy',    status: 'IN_PROGRESS', remarks: null, vendorName: 'Shilpa Tex' },
  { issueNo: 'FI-009', issueDate: '2026-08-25', rollNo: 'FAB-009', purpose: 'DYEING',   orderNo: 'B9663IS', styleNo: 'TB-0910-012', issuedByName: 'Maharaj Singh', fabricQtyIssued: '2500', fabricName: '12 oz 12x12', colorCode: 'Navy Blue',   status: 'IN_PROGRESS', remarks: 'Shade issue reported', vendorName: 'Shilpa Tex' },
  { issueNo: 'FI-010', issueDate: '2026-08-27', rollNo: 'FAB-010', purpose: 'CUTTING',  orderNo: 'B9670IS', styleNo: 'BS-0455-003', issuedByName: 'Maharaj Singh', fabricQtyIssued: '1600', fabricName: 'Jute Canvas', colorCode: 'Khaki',       status: 'PENDING',     remarks: null, vendorName: null },
];

/** Dye issue sheet - rows 8..14. Amount = Qty x Rate. DY numbers from Remark. */
export const dyeIssues = [
  { dyeIssueNo: 'DY-001', issueDate: '2026-08-10', process: 'DYEING',   rollNo: 'FAB-001', colourCode: 'Natural',     content: '100% Cotton',       count: '10x6',  construction: '76x28', width: '63', gsm: '320 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '2000', uom: 'Mtrs', rate: '42', remark: 'PO DY-001',     issueNo: 'FI-001', orderNo: 'B9641IS', status: 'COMPLETED' },
  { dyeIssueNo: 'DY-002', issueDate: '2026-08-12', process: 'DYEING',   rollNo: 'FAB-004', colourCode: 'Night Black', content: '100% Cotton',       count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '3000', uom: 'Mtrs', rate: '45', remark: 'PO DY-002',     issueNo: 'FI-004', orderNo: 'B9646IS', status: 'COMPLETED' },
  { dyeIssueNo: 'PJ-001', issueDate: '2026-08-15', process: 'PRINTING', rollNo: 'FAB-003', colourCode: 'Navy Blue',   content: 'Cotton-Poly 80:20', count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', vendorName: 'Bagru Prints',  address: 'Bagru, Jaipur',    pinCode: '303007', qty: '1200', uom: 'Mtrs', rate: '38', remark: 'Panel print',   issueNo: 'FI-003', orderNo: 'B9663IS', status: 'IN_PROGRESS' },
  { dyeIssueNo: 'DY-003', issueDate: '2026-08-17', process: 'DYEING',   rollNo: 'FAB-005', colourCode: 'Olive Green', content: 'Canvas Cotton',     count: '10x6',  construction: '76x28', width: '60', gsm: '280 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '2200', uom: 'Mtrs', rate: '44', remark: 'PO DY-003',     issueNo: 'FI-005', orderNo: 'B9652IS', status: 'COMPLETED' },
  { dyeIssueNo: 'DY-004', issueDate: '2026-08-19', process: 'DYEING',   rollNo: 'FAB-006', colourCode: 'Off White',   content: 'Recycled Cotton',   count: '10x6',  construction: '48x28', width: '58', gsm: '260 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '1500', uom: 'Mtrs', rate: '40', remark: 'PO DY-004',     issueNo: 'FI-006', orderNo: 'B9658IS', status: 'COMPLETED' },
  { dyeIssueNo: 'PJ-002', issueDate: '2026-08-21', process: 'PRINTING', rollNo: 'FAB-007', colourCode: 'Khaki',       content: '100% Jute',         count: '8x4',   construction: '68x38', width: '60', gsm: '400 GSM', vendorName: 'Sempax Unit 1', address: 'Sitapura, Jaipur', pinCode: '302022', qty: '1100', uom: 'Mtrs', rate: '36', remark: 'Roll printing', issueNo: 'FI-007', orderNo: 'B9670IS', status: 'IN_PROGRESS' },
  { dyeIssueNo: 'DY-005', issueDate: '2026-08-23', process: 'DYEING',   rollNo: 'FAB-008', colourCode: 'Burgundy',    content: 'Recycled Cotton',   count: '10x6',  construction: '48x28', width: '58', gsm: '260 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '1800', uom: 'Mtrs', rate: '41', remark: 'PO DY-005',     issueNo: 'FI-008', orderNo: 'B9675IS', status: 'COMPLETED' },
  // DY-006 and DY-007 are NOT rows of the "Dye issue" sheet, which sampled only
  // 7 rows. They are required because the "Dyeing Receipt" sheet books returns
  // against DY-006/FAB-009 and DY-007/FAB-010. Added so the chain closes.
  { dyeIssueNo: 'DY-006', issueDate: '2026-08-25', process: 'DYEING',   rollNo: 'FAB-009', colourCode: 'Navy Blue',   content: 'Cotton-Poly 80:20', count: '12x12', construction: '60x60', width: '63', gsm: '340 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '2500', uom: 'Mtrs', rate: '45', remark: 'PO DY-006',     issueNo: 'FI-009', orderNo: 'B9663IS', status: 'COMPLETED' },
  { dyeIssueNo: 'DY-007', issueDate: '2026-08-27', process: 'DYEING',   rollNo: 'FAB-010', colourCode: 'Khaki',       content: '100% Jute',         count: '8x4',   construction: '68x38', width: '60', gsm: '400 GSM', vendorName: 'Shilpa Tex',    address: 'Bagru, Jaipur',    pinCode: '303007', qty: '1600', uom: 'Mtrs', rate: '43', remark: 'PO DY-007',     issueNo: 'FI-010', orderNo: 'B9670IS', status: 'COMPLETED' },
];

/**
 * Dyeing Receipt sheet (Shekwati4.xlsx) - rows 7..13, seeded verbatim.
 * Shrinkage %    = (Qty Issued - Qty Received) / Qty Issued
 * Variation Flag = Shrinkage % > Standard Shrinkage Allowed
 * Status         = OK / Sent to Scrutiny
 */
export const dyeingReceipts = [
  { receiptNo: 'DR-001', receiptDate: '2026-08-14', dyeIssueNo: 'DY-001', rollNo: 'FAB-001', qtyIssued: '2000', qtyReceived: '1950', standardShrinkageAllowed: '0.03', status: 'OK',               remarks: 'Within tolerance' },
  { receiptNo: 'DR-002', receiptDate: '2026-08-16', dyeIssueNo: 'DY-002', rollNo: 'FAB-004', qtyIssued: '3000', qtyReceived: '2895', standardShrinkageAllowed: '0.03', status: 'OK',               remarks: '3.5% - borderline' },
  { receiptNo: 'DR-003', receiptDate: '2026-08-18', dyeIssueNo: 'DY-003', rollNo: 'FAB-005', qtyIssued: '2200', qtyReceived: '2090', standardShrinkageAllowed: '0.03', status: 'SENT_TO_SCRUTINY', remarks: '5% shrinkage - shade issue' },
  { receiptNo: 'DR-004', receiptDate: '2026-08-22', dyeIssueNo: 'DY-004', rollNo: 'FAB-006', qtyIssued: '1500', qtyReceived: '1470', standardShrinkageAllowed: '0.03', status: 'OK',               remarks: null },
  { receiptNo: 'DR-005', receiptDate: '2026-08-25', dyeIssueNo: 'DY-005', rollNo: 'FAB-008', qtyIssued: '1800', qtyReceived: '1746', standardShrinkageAllowed: '0.03', status: 'OK',               remarks: null },
  { receiptNo: 'DR-006', receiptDate: '2026-08-26', dyeIssueNo: 'DY-006', rollNo: 'FAB-009', qtyIssued: '2500', qtyReceived: '2350', standardShrinkageAllowed: '0.03', status: 'SENT_TO_SCRUTINY', remarks: '6% - to be discussed with vendor' },
  { receiptNo: 'DR-007', receiptDate: '2026-08-28', dyeIssueNo: 'DY-007', rollNo: 'FAB-010', qtyIssued: '1600', qtyReceived: '1568', standardShrinkageAllowed: '0.03', status: 'OK',               remarks: null },
];

/** Printing sheet - rows 6..12 (headers on row 3 in the workbook). */
export const printings = [
  { printingNo: 'PR-001', printingDate: '2026-08-15', orderNo: 'B9663IS', styleNo: 'TB-0910-012', vendorName: 'Bagru Prints',  fabricStage: 'BEFORE_STITCHING', qty: '1200', uom: 'Roll', remarks: 'Panel print - 2 colour', status: 'COMPLETED' },
  { printingNo: 'PR-002', printingDate: '2026-08-17', orderNo: 'B9663IS', styleNo: 'TB-0910-012', vendorName: 'Bagru Prints',  fabricStage: 'BEFORE_STITCHING', qty: '800',  uom: 'Roll', remarks: 'Second lot', status: 'COMPLETED' },
  { printingNo: 'PR-003', printingDate: '2026-08-21', orderNo: 'B9670IS', styleNo: 'BS-0455-003', vendorName: 'Sempax Unit 1', fabricStage: 'BEFORE_STITCHING', qty: '1100', uom: 'Roll', remarks: 'Roll printing', status: 'IN_PROGRESS' },
  { printingNo: 'PR-004', printingDate: '2026-08-24', orderNo: 'B9641IS', styleNo: 'TR-0751-008', vendorName: 'Bagru Prints',  fabricStage: 'AFTER_STITCHING',  qty: '500',  uom: 'Pcs',  remarks: 'Logo print on finished bag', status: 'IN_PROGRESS' },
  { printingNo: 'PR-005', printingDate: '2026-08-26', orderNo: 'B9646IS', styleNo: 'TR-0751-009', vendorName: 'Bagru Prints',  fabricStage: 'AFTER_STITCHING',  qty: '750',  uom: 'Pcs',  remarks: 'Buyer logo', status: 'PENDING' },
  { printingNo: 'PR-006', printingDate: '2026-08-28', orderNo: 'B9652IS', styleNo: 'TR-0752-101', vendorName: 'Sempax Unit 1', fabricStage: 'BEFORE_STITCHING', qty: '900',  uom: 'Roll', remarks: null, status: 'PENDING' },
  { printingNo: 'PR-007', printingDate: '2026-08-30', orderNo: 'B9675IS', styleNo: 'PU-0330-046', vendorName: 'Bagru Prints',  fabricStage: 'AFTER_STITCHING',  qty: '400',  uom: 'Pcs',  remarks: 'Small flap print', status: 'PENDING' },
];

/** Fabric Scrutiny Report sheet - rows 7..13. */
export const fabricScrutinies = [
  { scrutinyNo: 'FS-001', scrutinyDate: '2026-08-18', rollNo: 'FAB-005', orderNo: 'B9652IS', styleNo: 'TR-0752-101', defectType: 'Dyeing Shade Variation', qtyAffected: '110', checkedByName: 'Sunita Devi',  authorisedBy: 'Dinesh Sir', decision: 'REWORK', remarks: 'Re-dye at vendor cost' },
  { scrutinyNo: 'FS-002', scrutinyDate: '2026-08-19', rollNo: 'FAB-005', orderNo: 'B9652IS', styleNo: 'TR-0752-101', defectType: 'Weaving Defect',         qtyAffected: '40',  checkedByName: 'Rekha Sharma', authorisedBy: 'Dinesh Sir', decision: 'REJECT', remarks: 'Debit note to vendor' },
  { scrutinyNo: 'FS-003', scrutinyDate: '2026-08-26', rollNo: 'FAB-009', orderNo: 'B9663IS', styleNo: 'TB-0910-012', defectType: 'Dyeing Shade Variation', qtyAffected: '150', checkedByName: 'Sunita Devi',  authorisedBy: 'Dinesh Sir', decision: 'REWORK', remarks: 'Shade card mismatch' },
  { scrutinyNo: 'FS-004', scrutinyDate: '2026-08-27', rollNo: 'FAB-009', orderNo: 'B9663IS', styleNo: 'TB-0910-012', defectType: 'Cut/Hole',               qtyAffected: '25',  checkedByName: 'Rekha Sharma', authorisedBy: 'Dinesh Sir', decision: 'REJECT', remarks: 'Loom damage' },
  { scrutinyNo: 'FS-005', scrutinyDate: '2026-08-29', rollNo: 'FAB-002', orderNo: 'B9641IS', styleNo: 'TR-0751-008', defectType: 'Stain',                  qtyAffected: '18',  checkedByName: 'Sunita Devi',  authorisedBy: 'Dinesh Sir', decision: 'ACCEPT', remarks: 'Washable - accepted' },
  { scrutinyNo: 'FS-006', scrutinyDate: '2026-08-30', rollNo: 'FAB-006', orderNo: 'B9658IS', styleNo: 'PU-0330-045', defectType: 'Weaving Defect',         qtyAffected: '32',  checkedByName: 'Rekha Sharma', authorisedBy: 'Dinesh Sir', decision: 'REWORK', remarks: 'Panel re-cut possible' },
  { scrutinyNo: 'FS-007', scrutinyDate: '2026-08-31', rollNo: 'FAB-008', orderNo: 'B9675IS', styleNo: 'PU-0330-046', defectType: 'Dyeing Shade Variation', qtyAffected: '60',  checkedByName: 'Sunita Devi',  authorisedBy: 'Dinesh Sir', decision: 'ACCEPT', remarks: 'Within buyer tolerance' },
];

/** " Plan Approval" sheet - rows 7..13. round increments on resubmission. */
export const planApprovals = [
  { approvalNo: 'PA-001', submittedDate: '2026-08-11', orderNo: 'B9641IS', containerNo: 'CN-91', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'APPROVED', rejectionReason: null,                     rectificationRemarks: null,              approvedDate: '2026-08-12', round: 1 },
  { approvalNo: 'PA-002', submittedDate: '2026-08-15', orderNo: 'B9646IS', containerNo: 'CN-92', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'APPROVED', rejectionReason: null,                     rectificationRemarks: null,              approvedDate: '2026-08-16', round: 1 },
  { approvalNo: 'PA-003', submittedDate: '2026-08-17', orderNo: 'B9652IS', containerNo: 'CN-93', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'REJECTED', rejectionReason: 'Unit 3 overloaded',      rectificationRemarks: 'Shift 1500 pcs to Unit 4', approvedDate: null,        round: 1 },
  { approvalNo: 'PA-004', submittedDate: '2026-08-18', orderNo: 'B9652IS', containerNo: 'CN-93', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'APPROVED', rejectionReason: null,                     rectificationRemarks: 'Revised plan v2', approvedDate: '2026-08-18', round: 2 },
  { approvalNo: 'PA-005', submittedDate: '2026-08-21', orderNo: 'B9658IS', containerNo: 'CN-94', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'REJECTED', rejectionReason: 'Shipping date too tight', rectificationRemarks: 'Extend cutting by 3 days', approvedDate: null,       round: 1 },
  { approvalNo: 'PA-006', submittedDate: '2026-08-22', orderNo: 'B9658IS', containerNo: 'CN-94', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'APPROVED', rejectionReason: null,                     rectificationRemarks: 'Revised plan v2', approvedDate: '2026-08-23', round: 2 },
  { approvalNo: 'PA-007', submittedDate: '2026-08-24', orderNo: 'B9663IS', containerNo: 'CN-95', preparedBy: 'Vinay ji (GM)', submittedTo: 'Dinesh Sir', approvalStatus: 'PENDING',  rejectionReason: null,                     rectificationRemarks: 'Awaiting fabric scrutiny', approvedDate: null,       round: 1 },
];

/** Cutting Issue sheet - rows 7..13. FINAL STAGE. */
export const cuttingIssues = [
  { challanNo: 'CH-001', issueDate: '2026-08-13', orderNo: 'B9641IS', styleNo: 'TR-0751-008', plannedCutting: '5000',  firmName: 'Unit 1 - Anil Kumar', unitWiseCuttingPcsToBeIssued: '2500', cuttingPcsIssued: '2500', handleIssued: '2500', containerNo: 'CN-91', status: 'COMPLETED',   remarks: 'Lot 1', approvalNo: 'PA-001', issueNo: 'FI-002' },
  { challanNo: 'CH-002', issueDate: '2026-08-14', orderNo: 'B9641IS', styleNo: 'TR-0751-008', plannedCutting: '5000',  firmName: 'Unit 1 - Anil Kumar', unitWiseCuttingPcsToBeIssued: '2500', cuttingPcsIssued: '2500', handleIssued: '2500', containerNo: 'CN-91', status: 'COMPLETED',   remarks: 'Lot 2', approvalNo: 'PA-001', issueNo: 'FI-002' },
  { challanNo: 'CH-003', issueDate: '2026-08-16', orderNo: 'B9646IS', styleNo: 'TR-0751-009', plannedCutting: '7000',  firmName: 'Unit 2 - Mahipal',    unitWiseCuttingPcsToBeIssued: '3500', cuttingPcsIssued: '3500', handleIssued: '3500', containerNo: 'CN-92', status: 'COMPLETED',   remarks: 'Lot 1', approvalNo: 'PA-002', issueNo: 'FI-004' },
  { challanNo: 'CH-004', issueDate: '2026-08-18', orderNo: 'B9646IS', styleNo: 'TR-0751-009', plannedCutting: '7000',  firmName: 'Unit 2 - Mahipal',    unitWiseCuttingPcsToBeIssued: '3500', cuttingPcsIssued: '3500', handleIssued: '3500', containerNo: 'CN-92', status: 'IN_PROGRESS', remarks: 'Lot 2', approvalNo: 'PA-002', issueNo: 'FI-004' },
  { challanNo: 'CH-005', issueDate: '2026-08-19', orderNo: 'B9652IS', styleNo: 'TR-0752-101', plannedCutting: '4000',  firmName: 'Unit 3 - Ramesh',     unitWiseCuttingPcsToBeIssued: '2000', cuttingPcsIssued: '2000', handleIssued: '2000', containerNo: 'CN-93', status: 'IN_PROGRESS', remarks: 'Gusset panels separate', approvalNo: 'PA-004', issueNo: 'FI-005' },
  { challanNo: 'CH-006', issueDate: '2026-08-22', orderNo: 'B9658IS', styleNo: 'PU-0330-045', plannedCutting: '10000', firmName: 'Unit 4 - Suresh',     unitWiseCuttingPcsToBeIssued: '5000', cuttingPcsIssued: '5000', handleIssued: '5000', containerNo: 'CN-94', status: 'IN_PROGRESS', remarks: 'Lot 1 of 2', approvalNo: 'PA-006', issueNo: null },
  { challanNo: 'CH-007', issueDate: '2026-08-25', orderNo: 'B9663IS', styleNo: 'TB-0910-012', plannedCutting: '6000',  firmName: 'Unit 1 - Anil Kumar', unitWiseCuttingPcsToBeIssued: '3000', cuttingPcsIssued: '3000', handleIssued: '3000', containerNo: 'CN-95', status: 'PENDING',     remarks: 'Printed panels', approvalNo: 'PA-007', issueNo: null },
];

/**
 * Document sequences. nextNumber is set past the seeded sample rows so the
 * first document created through the ERP continues the workbook numbering.
 */
/**
 * CONFIGURABLE EXCESS THRESHOLDS.
 *
 * Every percentage the workbook and the process document specify, as data.
 * None of these numbers appears as a constant in any service any more: the
 * excess engine resolves a rule out of this table, narrowest scope first
 *
 *     ORDER  ->  BUYER  ->  ITEM_CATEGORY  ->  DOCUMENT_TYPE  ->  GLOBAL
 *
 * so that changing what a buyer is allowed is a row on a screen rather than a
 * deployment. The seeded values reproduce the workbook exactly, so nothing
 * behaves differently on day one.
 *
 * hardCeilingPct is the point past which an excess cannot be authorised at
 * all, only refused. Null means an approver may allow any excess with a
 * reason.
 */
export const excessRules = [
  { scope: 'GLOBAL',        scopeKey: '',               documentType: null,             excessPct: '0.02', hardCeilingPct: '0.05', requiresApproval: true,  priority: 0,  basis: 'Default tolerance. Process Documentation s.5: a 2% excess variation is accepted generally.' },
  { scope: 'DOCUMENT_TYPE', scopeKey: 'PURCHASE_ORDER', documentType: 'PURCHASE_ORDER', excessPct: '0.03', hardCeilingPct: '0.05', requiresApproval: true,  priority: 10, basis: 'PO sheet, note beside the Excess Allowed column: "2-3%".' },
  { scope: 'ITEM_CATEGORY', scopeKey: 'Accessories',    documentType: 'PURCHASE_ORDER', excessPct: '0.01', hardCeilingPct: '0.03', requiresApproval: true,  priority: 20, basis: 'Process Documentation s.5: accessories may be ordered only 1% over requirement.' },
  { scope: 'DOCUMENT_TYPE', scopeKey: 'GRN',            documentType: 'GRN',            excessPct: '0.02', hardCeilingPct: '0.05', requiresApproval: true,  priority: 10, basis: 'Process Documentation s.5: a 2% excess variation is accepted on material generally.' },
  { scope: 'ITEM_CATEGORY', scopeKey: 'Accessories',    documentType: 'GRN',            excessPct: '0.03', hardCeilingPct: '0.03', requiresApproval: true,  priority: 20, basis: 'Process Documentation s.5: accessories may be received up to 3% in excess and no more.' },
  { scope: 'DOCUMENT_TYPE', scopeKey: 'DYE_ISSUE',      documentType: 'DYE_ISSUE',      excessPct: '0.03', hardCeilingPct: '0.10', requiresApproval: false, priority: 10, basis: 'Process Documentation: 2-3% shrinkage is normal on a dye lot. Advisory - an out-of-tolerance return goes to scrutiny rather than being refused.' },
  { scope: 'DOCUMENT_TYPE', scopeKey: 'BUYER_ORDER',    documentType: 'BUYER_ORDER',    excessPct: '0.02', hardCeilingPct: '0.10', requiresApproval: true,  priority: 10, basis: 'Order sheet, note on the Excess column: "Approval from dinesh sir".' },
  { scope: 'DOCUMENT_TYPE', scopeKey: 'CUTTING_ISSUE',  documentType: 'CUTTING_ISSUE',  excessPct: '0.02', hardCeilingPct: '0.05', requiresApproval: true,  priority: 10, basis: 'Cutting beyond the approved plan needs the same authority as ordering beyond the style.' },
];

export const documentSequences = [
  { documentType: 'BUYER_ORDER',      scopeKey: '', prefix: 'SO',  separator: '-', padLength: 5, nextNumber: 1,  description: 'Fallback order number when the buyer PO number is not yet known' },
  { documentType: 'VENDOR',           scopeKey: '', prefix: 'VEN', separator: '-', padLength: 3, nextNumber: 8,  description: 'Vendor Master - VEN-001' },
  { documentType: 'EMPLOYEE',         scopeKey: '', prefix: 'EMP', separator: '-', padLength: 3, nextNumber: 12, description: 'Employee Master - EMP-001' },
  { documentType: 'VENDOR_QUOTATION', scopeKey: '', prefix: 'QT',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Vendor Quotation - QT-001' },
  { documentType: 'GATE_PASS',        scopeKey: '', prefix: 'GP',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Gate Pass - GP-001' },
  { documentType: 'GRN',              scopeKey: '', prefix: 'GRN', separator: '-', padLength: 3, nextNumber: 8,  description: 'Goods Receipt Note - GRN-001' },
  { documentType: 'FABRIC_ROLL',      scopeKey: '', prefix: 'FAB', separator: '-', padLength: 3, nextNumber: 11, description: 'Fabric Roll / Fabric No - FAB-001' },
  // Not a workbook document - the inventory master has no sheet. Item codes
  // come from this counter so that a GRN which rolls back gives its item code
  // back along with everything else it wrote.
  { documentType: 'INVENTORY_ITEM',   scopeKey: '', prefix: 'ITM', separator: '-', padLength: 4, nextNumber: 100, description: 'Inventory item code - ITM-0001' },
  { documentType: 'FABRIC_ISSUE',     scopeKey: '', prefix: 'FI',  separator: '-', padLength: 3, nextNumber: 11, description: 'Fabric Issue for Cutting - FI-001' },
  { documentType: 'DYE_ISSUE',        scopeKey: 'DYEING',   prefix: 'DY',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Dyeing job work issue PO - DY-001' },
  { documentType: 'DYE_ISSUE',        scopeKey: 'PRINTING', prefix: 'PJ',  separator: '-', padLength: 3, nextNumber: 3,  description: 'Printing job work issue PO - PJ-001' },
  { documentType: 'DYEING_RECEIPT',   scopeKey: '', prefix: 'DR',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Fabric received from dyeing - DR-001' },
  { documentType: 'PRINTING',         scopeKey: '', prefix: 'PR',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Printing - PR-001' },
  { documentType: 'FABRIC_SCRUTINY',  scopeKey: '', prefix: 'FS',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Fabric Scrutiny Report - FS-001' },
  { documentType: 'PLANNING',         scopeKey: '', prefix: 'PLN', separator: '-', padLength: 3, nextNumber: 6,  description: 'Planning - PLN-001' },
  { documentType: 'PLAN_APPROVAL',    scopeKey: '', prefix: 'PA',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Plan Approval log - PA-001' },
  { documentType: 'CUTTING_ISSUE',    scopeKey: '', prefix: 'CH',  separator: '-', padLength: 3, nextNumber: 8,  description: 'Cutting Issue challan - CH-001' },
  { documentType: 'CUT_PIECES_RECEIPT', scopeKey: '', prefix: 'CPR', separator: '-', padLength: 4, nextNumber: 1,  description: 'Cut pieces received from cutting - CPR-0001' },
  { documentType: 'COST_SHEET', scopeKey: '', prefix: 'CS', separator: '-', padLength: 4, nextNumber: 1,  description: 'FOB cost sheet of a style - CS-0001' },
  // PO IDs run one counter per vendor: "Vendor initial + no" (PO sheet, row 3).
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'RF', prefix: 'RF', separator: '-', padLength: 3, nextNumber: 5, description: 'PO - Rajasthan Fabrics' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'MA', prefix: 'MA', separator: '-', padLength: 3, nextNumber: 4, description: 'PO - Metro Accessories' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'ST', prefix: 'ST', separator: '-', padLength: 3, nextNumber: 1, description: 'PO - Shilpa Tex' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'BP', prefix: 'BP', separator: '-', padLength: 3, nextNumber: 1, description: 'PO - Bagru Prints' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'SU', prefix: 'SU', separator: '-', padLength: 3, nextNumber: 1, description: 'PO - Sempax Unit 1' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'AK', prefix: 'AK', separator: '-', padLength: 3, nextNumber: 1, description: 'PO - Anil Kumar Stitching' },
  { documentType: 'PURCHASE_ORDER',   scopeKey: 'QS', prefix: 'QS', separator: '-', padLength: 3, nextNumber: 1, description: 'PO - QualiCheck Services' },
];
