-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusGeneral" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatusApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StatusActive" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GatePassType" AS ENUM ('INWARD', 'OUTWARD');

-- CreateEnum
CREATE TYPE "StatusGatePass" AS ENUM ('PENDING', 'CLEARED');

-- CreateEnum
CREATE TYPE "ScrutinyDecision" AS ENUM ('ACCEPT', 'REJECT', 'REWORK');

-- CreateEnum
CREATE TYPE "StatusDyeReceipt" AS ENUM ('OK', 'SENT_TO_SCRUTINY');

-- CreateEnum
CREATE TYPE "FabricStage" AS ENUM ('BEFORE_STITCHING', 'AFTER_STITCHING');

-- CreateEnum
CREATE TYPE "JobWorkProcess" AS ENUM ('DYEING', 'PRINTING', 'WASHING', 'FINISHING');

-- CreateEnum
CREATE TYPE "IssuePurpose" AS ENUM ('CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER');

-- CreateEnum
CREATE TYPE "GrnPurpose" AS ENUM ('RAW_MATERIAL', 'DYEING', 'PRINTING', 'JOB_WORK_RETURN', 'ACCESSORIES');

-- CreateEnum
CREATE TYPE "PlanDepartment" AS ENUM ('CUTTING', 'STITCHING', 'SHIPPING');

-- CreateEnum
CREATE TYPE "PoOrderType" AS ENUM ('ORDER_AS_PER_STYLE', 'BULK_ORDER');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "RollStage" AS ENUM ('RAW', 'ISSUED_FOR_DYEING', 'ISSUED_FOR_PRINTING', 'DYED', 'PRINTED', 'SCRUTINY_HOLD', 'ISSUED_TO_CUTTING', 'CONSUMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REWORK_REQUESTED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BUYER', 'VENDOR', 'EMPLOYEE', 'STYLE', 'BUYER_ORDER', 'PLANNING', 'VENDOR_QUOTATION', 'PURCHASE_ORDER', 'GATE_PASS', 'GRN', 'FABRIC_ROLL', 'FABRIC_ISSUE', 'DYE_ISSUE', 'DYEING_RECEIPT', 'PRINTING', 'FABRIC_SCRUTINY', 'PLAN_APPROVAL', 'CUTTING_ISSUE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "email" VARCHAR(150),
    "full_name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "module" VARCHAR(60) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "scope_key" VARCHAR(40) NOT NULL DEFAULT '',
    "prefix" VARCHAR(20) NOT NULL DEFAULT '',
    "suffix" VARCHAR(20) NOT NULL DEFAULT '',
    "separator" VARCHAR(5) NOT NULL DEFAULT '-',
    "pad_length" INTEGER NOT NULL DEFAULT 3,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_history" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_id" UUID NOT NULL,
    "document_no" VARCHAR(60) NOT NULL,
    "sequence_no" INTEGER NOT NULL DEFAULT 1,
    "action" "ApprovalAction" NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30),
    "acted_by_name" VARCHAR(120),
    "acted_by_id" UUID,
    "acted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "approval_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_amendments" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_id" UUID NOT NULL,
    "document_no" VARCHAR(60) NOT NULL,
    "amendment_no" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "remarks" TEXT,
    "amended_by_id" UUID,
    "amended_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "table_name" VARCHAR(80) NOT NULL,
    "record_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "user_id" UUID,
    "user_name" VARCHAR(120),
    "ip_address" VARCHAR(60),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_lists" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "master_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_list_values" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "value" VARCHAR(150) NOT NULL,
    "code" VARCHAR(60),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "master_list_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" UUID NOT NULL,
    "buyer_code" VARCHAR(20) NOT NULL,
    "buyer_name" VARCHAR(150) NOT NULL,
    "address" TEXT,
    "country" VARCHAR(80),
    "contact_person" VARCHAR(120),
    "email" VARCHAR(150),
    "phone" VARCHAR(40),
    "currency" VARCHAR(10),
    "payment_terms" VARCHAR(150),
    "status" "StatusActive" NOT NULL DEFAULT 'ACTIVE',
    "consignee_name" VARCHAR(200),
    "consignee_address" TEXT,
    "notify_party_name" VARCHAR(200),
    "notify_party_address" TEXT,
    "destination" VARCHAR(120),
    "port_of_discharge" VARCHAR(120),
    "final_destination" VARCHAR(120),
    "price_terms" VARCHAR(150),
    "ship_mode" VARCHAR(40),
    "freight_terms" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "vendor_code" VARCHAR(20) NOT NULL,
    "vendor_name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "address" TEXT,
    "gst_no" VARCHAR(20),
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(40),
    "email" VARCHAR(150),
    "bank_details" VARCHAR(200),
    "status" "StatusActive" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "po_initials" VARCHAR(10),
    "pin_code" VARCHAR(12),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "emp_id" VARCHAR(20) NOT NULL,
    "emp_name" VARCHAR(120) NOT NULL,
    "department" VARCHAR(60) NOT NULL,
    "designation" VARCHAR(60) NOT NULL,
    "unit_line" VARCHAR(80),
    "status" "StatusActive" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "styles" (
    "id" UUID NOT NULL,
    "style_no" VARCHAR(40) NOT NULL,
    "style_description" VARCHAR(200) NOT NULL,
    "buyer_id" UUID NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "fabric_content" VARCHAR(80),
    "avg_fabric_utilization_per_pc" DECIMAL(12,4) NOT NULL,
    "avg_utilization_uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
    "size_group" VARCHAR(40),
    "image_ref" VARCHAR(200),
    "status" "StatusActive" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_bom_lines" (
    "id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_category" VARCHAR(60) NOT NULL,
    "sub_category" VARCHAR(60),
    "accessories_item" VARCHAR(80),
    "description" VARCHAR(200),
    "color_code" VARCHAR(60),
    "content" VARCHAR(80),
    "gsm" VARCHAR(20),
    "count" VARCHAR(20),
    "construction" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "qty_per_pc" DECIMAL(12,4) NOT NULL,
    "wastage_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "hsn_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "style_bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_orders" (
    "id" UUID NOT NULL,
    "order_no" VARCHAR(40) NOT NULL,
    "order_date" DATE NOT NULL,
    "item_description" VARCHAR(200),
    "buyer_id" UUID NOT NULL,
    "bill_to" TEXT,
    "ship_to" TEXT,
    "buyer_delivery_date" DATE,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "style_id" UUID NOT NULL,
    "color_code" VARCHAR(60),
    "currency" VARCHAR(10),
    "ship_mode" VARCHAR(40),
    "size_group" VARCHAR(40),
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "excess_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "buyer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plannings" (
    "id" UUID NOT NULL,
    "plan_no" VARCHAR(40) NOT NULL,
    "plan_department" "PlanDepartment" NOT NULL,
    "container_no" VARCHAR(40),
    "order_id" UUID NOT NULL,
    "style_no" VARCHAR(40) NOT NULL,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "plan_date" DATE NOT NULL,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "approval_status" "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "plannings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_lines" (
    "id" UUID NOT NULL,
    "planning_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "line_date" DATE NOT NULL,
    "unit" VARCHAR(80),
    "deliverable_size" DECIMAL(18,4) NOT NULL,
    "cutting_pcs_allotted" DECIMAL(18,4),
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "planning_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_quotations" (
    "id" UUID NOT NULL,
    "quotation_no" VARCHAR(40) NOT NULL,
    "quotation_date" DATE NOT NULL,
    "item" VARCHAR(60) NOT NULL,
    "sub_category" VARCHAR(60),
    "accessories_item" VARCHAR(80),
    "vendor_id" UUID NOT NULL,
    "rate_quoted" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "authorised_by" VARCHAR(120),
    "authorisation_status" "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "order_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "vendor_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_id" VARCHAR(40) NOT NULL,
    "po_date" DATE NOT NULL,
    "item" VARCHAR(60) NOT NULL,
    "sub_category" VARCHAR(60),
    "accessories_item" VARCHAR(80),
    "excess_allowed" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "vendor_id" UUID NOT NULL,
    "address" TEXT,
    "uom" VARCHAR(20) NOT NULL,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "hsn_code" VARCHAR(20),
    "gsm" VARCHAR(20),
    "content" VARCHAR(80),
    "color_code" VARCHAR(60),
    "count" VARCHAR(20),
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "order_type" "PoOrderType" NOT NULL DEFAULT 'ORDER_AS_PER_STYLE',
    "order_id" UUID,
    "style_id" UUID,
    "quotation_id" UUID,
    "approval_status" "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "approved_by_name" VARCHAR(120),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_passes" (
    "id" UUID NOT NULL,
    "gate_pass_no" VARCHAR(40) NOT NULL,
    "gate_pass_date" DATE NOT NULL,
    "type" "GatePassType" NOT NULL,
    "linked_doc_no" VARCHAR(40) NOT NULL,
    "purchase_order_id" UUID,
    "dye_issue_id" UUID,
    "cutting_issue_id" UUID,
    "item" VARCHAR(80) NOT NULL,
    "vendor_id" UUID,
    "party_name" VARCHAR(150) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4),
    "variation_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "purpose" "IssuePurpose" NOT NULL,
    "authorised_by" VARCHAR(120),
    "status" "StatusGatePass" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "gate_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grns" (
    "id" UUID NOT NULL,
    "grn_no" VARCHAR(40) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "bill_no" VARCHAR(60) NOT NULL,
    "roll_no" VARCHAR(40),
    "grn_date" DATE NOT NULL,
    "purpose" "GrnPurpose" NOT NULL,
    "item" VARCHAR(80) NOT NULL,
    "hsn_code" VARCHAR(20),
    "vendor_id" UUID NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "receiving_qty" DECIMAL(18,4) NOT NULL,
    "inventory_rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "variation_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "tolerance_breached" BOOLEAN NOT NULL DEFAULT false,
    "gate_pass_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "grns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_rolls" (
    "id" UUID NOT NULL,
    "roll_no" VARCHAR(40) NOT NULL,
    "grn_id" UUID,
    "vendor_id" UUID,
    "fabric_name" VARCHAR(120),
    "color_code" VARCHAR(60),
    "content" VARCHAR(80),
    "count" VARCHAR(20),
    "construction" VARCHAR(20),
    "width" DECIMAL(10,2),
    "gsm" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
    "received_qty" DECIMAL(18,4) NOT NULL,
    "balance_qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4),
    "stage" "RollStage" NOT NULL DEFAULT 'RAW',
    "location" VARCHAR(80),
    "is_held" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "inventory_item_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "fabric_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "item_code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "item_category" VARCHAR(60) NOT NULL,
    "sub_category" VARCHAR(60) NOT NULL DEFAULT '',
    "accessories_item" VARCHAR(80) NOT NULL DEFAULT '',
    "color_code" VARCHAR(60) NOT NULL DEFAULT '',
    "content" VARCHAR(80),
    "gsm" VARCHAR(20) NOT NULL DEFAULT '',
    "count" VARCHAR(20) NOT NULL DEFAULT '',
    "uom" VARCHAR(20) NOT NULL,
    "hsn_code" VARCHAR(20),
    "is_roll_tracked" BOOLEAN NOT NULL DEFAULT false,
    "reorder_level" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location" VARCHAR(80) NOT NULL DEFAULT 'MAIN STORE',
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "avg_rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "in_process_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "item_id" UUID NOT NULL,
    "roll_id" UUID,
    "location" VARCHAR(80) NOT NULL DEFAULT 'MAIN STORE',
    "document_type" "DocumentType" NOT NULL,
    "document_id" UUID NOT NULL,
    "document_no" VARCHAR(60) NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance_qty" DECIMAL(18,4) NOT NULL,
    "grn_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_issues" (
    "id" UUID NOT NULL,
    "issue_no" VARCHAR(40) NOT NULL,
    "issue_date" DATE NOT NULL,
    "vendor_id" UUID,
    "roll_id" UUID NOT NULL,
    "purpose" "IssuePurpose" NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "issued_by_employee_id" UUID,
    "issued_by_name" VARCHAR(120) NOT NULL,
    "fabric_qty_issued" DECIMAL(18,4) NOT NULL,
    "fabric_name" VARCHAR(120),
    "color_code" VARCHAR(60),
    "uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "fabric_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dye_issues" (
    "id" UUID NOT NULL,
    "dye_issue_no" VARCHAR(40) NOT NULL,
    "issue_date" DATE NOT NULL,
    "process" "JobWorkProcess" NOT NULL,
    "roll_id" UUID NOT NULL,
    "colour_code" VARCHAR(60),
    "content" VARCHAR(80),
    "count" VARCHAR(20),
    "construction" VARCHAR(20),
    "width" DECIMAL(10,2),
    "gsm" VARCHAR(20),
    "vendor_id" UUID NOT NULL,
    "address" TEXT,
    "pin_code" VARCHAR(12),
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "remark" TEXT,
    "standard_shrinkage_allowed" DECIMAL(9,6) NOT NULL DEFAULT 0.03,
    "fabric_issue_id" UUID,
    "order_id" UUID,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "dye_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dyeing_receipts" (
    "id" UUID NOT NULL,
    "receipt_no" VARCHAR(40) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "dye_issue_id" UUID NOT NULL,
    "roll_id" UUID NOT NULL,
    "qty_issued" DECIMAL(18,4) NOT NULL,
    "qty_received" DECIMAL(18,4) NOT NULL,
    "shrinkage_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "standard_shrinkage_allowed" DECIMAL(9,6) NOT NULL DEFAULT 0.03,
    "variation_flag" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusDyeReceipt" NOT NULL DEFAULT 'OK',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "dyeing_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printings" (
    "id" UUID NOT NULL,
    "printing_no" VARCHAR(40) NOT NULL,
    "printing_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "fabric_stage" "FabricStage" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "remarks" TEXT,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "printings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_scrutinies" (
    "id" UUID NOT NULL,
    "scrutiny_no" VARCHAR(40) NOT NULL,
    "scrutiny_date" DATE NOT NULL,
    "roll_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "defect_type" VARCHAR(80) NOT NULL,
    "qty_affected" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
    "checked_by_employee_id" UUID,
    "checked_by_name" VARCHAR(120) NOT NULL,
    "authorised_by" VARCHAR(120),
    "decision" "ScrutinyDecision" NOT NULL DEFAULT 'ACCEPT',
    "remarks" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "fabric_scrutinies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_approvals" (
    "id" UUID NOT NULL,
    "approval_no" VARCHAR(40) NOT NULL,
    "submitted_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "container_no" VARCHAR(40),
    "prepared_by" VARCHAR(120) NOT NULL,
    "submitted_to" VARCHAR(120) NOT NULL,
    "approval_status" "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "rectification_remarks" TEXT,
    "approved_date" DATE,
    "planning_id" UUID,
    "round" INTEGER NOT NULL DEFAULT 1,
    "prepared_by_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "plan_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_issues" (
    "id" UUID NOT NULL,
    "challan_no" VARCHAR(40) NOT NULL,
    "issue_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "planned_cutting" DECIMAL(18,4) NOT NULL,
    "firm_name" VARCHAR(120) NOT NULL,
    "unit_wise_cutting_pcs_to_be_issued" DECIMAL(18,4) NOT NULL,
    "cutting_pcs_issued" DECIMAL(18,4) NOT NULL,
    "handle_issued" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "container_no" VARCHAR(40),
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "planning_id" UUID,
    "plan_approval_id" UUID,
    "fabric_issue_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "cutting_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "users_employee_id_idx" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "roles_deleted_at_idx" ON "roles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_action_key" ON "permissions"("module", "action");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_document_type_scope_key_key" ON "document_sequences"("document_type", "scope_key");

-- CreateIndex
CREATE INDEX "approval_history_document_type_document_id_idx" ON "approval_history"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "approval_history_acted_at_idx" ON "approval_history"("acted_at");

-- CreateIndex
CREATE INDEX "document_amendments_document_type_document_id_idx" ON "document_amendments"("document_type", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_amendments_document_type_document_id_amendment_no_key" ON "document_amendments"("document_type", "document_id", "amendment_no");

-- CreateIndex
CREATE INDEX "audit_logs_table_name_record_id_idx" ON "audit_logs"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_lists_code_key" ON "master_lists"("code");

-- CreateIndex
CREATE INDEX "master_lists_deleted_at_idx" ON "master_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "master_list_values_list_id_is_active_sort_order_idx" ON "master_list_values"("list_id", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "master_list_values_deleted_at_idx" ON "master_list_values"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "master_list_values_list_id_value_key" ON "master_list_values"("list_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_buyer_code_key" ON "buyers"("buyer_code");

-- CreateIndex
CREATE INDEX "buyers_buyer_name_idx" ON "buyers"("buyer_name");

-- CreateIndex
CREATE INDEX "buyers_status_idx" ON "buyers"("status");

-- CreateIndex
CREATE INDEX "buyers_deleted_at_idx" ON "buyers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_vendor_code_key" ON "vendors"("vendor_code");

-- CreateIndex
CREATE INDEX "vendors_vendor_name_idx" ON "vendors"("vendor_name");

-- CreateIndex
CREATE INDEX "vendors_category_idx" ON "vendors"("category");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_deleted_at_idx" ON "vendors"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_emp_id_key" ON "employees"("emp_id");

-- CreateIndex
CREATE INDEX "employees_emp_name_idx" ON "employees"("emp_name");

-- CreateIndex
CREATE INDEX "employees_department_idx" ON "employees"("department");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_deleted_at_idx" ON "employees"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "styles_style_no_key" ON "styles"("style_no");

-- CreateIndex
CREATE INDEX "styles_buyer_id_idx" ON "styles"("buyer_id");

-- CreateIndex
CREATE INDEX "styles_category_idx" ON "styles"("category");

-- CreateIndex
CREATE INDEX "styles_status_idx" ON "styles"("status");

-- CreateIndex
CREATE INDEX "styles_deleted_at_idx" ON "styles"("deleted_at");

-- CreateIndex
CREATE INDEX "style_bom_lines_style_id_idx" ON "style_bom_lines"("style_id");

-- CreateIndex
CREATE INDEX "style_bom_lines_item_category_idx" ON "style_bom_lines"("item_category");

-- CreateIndex
CREATE INDEX "style_bom_lines_deleted_at_idx" ON "style_bom_lines"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "style_bom_lines_style_id_line_no_key" ON "style_bom_lines"("style_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_orders_order_no_key" ON "buyer_orders"("order_no");

-- CreateIndex
CREATE INDEX "buyer_orders_buyer_id_idx" ON "buyer_orders"("buyer_id");

-- CreateIndex
CREATE INDEX "buyer_orders_style_id_idx" ON "buyer_orders"("style_id");

-- CreateIndex
CREATE INDEX "buyer_orders_status_idx" ON "buyer_orders"("status");

-- CreateIndex
CREATE INDEX "buyer_orders_order_date_idx" ON "buyer_orders"("order_date");

-- CreateIndex
CREATE INDEX "buyer_orders_buyer_delivery_date_idx" ON "buyer_orders"("buyer_delivery_date");

-- CreateIndex
CREATE INDEX "buyer_orders_deleted_at_idx" ON "buyer_orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "plannings_plan_no_key" ON "plannings"("plan_no");

-- CreateIndex
CREATE INDEX "plannings_order_id_idx" ON "plannings"("order_id");

-- CreateIndex
CREATE INDEX "plannings_status_idx" ON "plannings"("status");

-- CreateIndex
CREATE INDEX "plannings_approval_status_idx" ON "plannings"("approval_status");

-- CreateIndex
CREATE INDEX "plannings_container_no_idx" ON "plannings"("container_no");

-- CreateIndex
CREATE INDEX "plannings_deleted_at_idx" ON "plannings"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "plannings_order_id_plan_department_version_key" ON "plannings"("order_id", "plan_department", "version");

-- CreateIndex
CREATE INDEX "planning_lines_planning_id_idx" ON "planning_lines"("planning_id");

-- CreateIndex
CREATE INDEX "planning_lines_line_date_idx" ON "planning_lines"("line_date");

-- CreateIndex
CREATE INDEX "planning_lines_deleted_at_idx" ON "planning_lines"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "planning_lines_planning_id_line_no_key" ON "planning_lines"("planning_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_quotations_quotation_no_key" ON "vendor_quotations"("quotation_no");

-- CreateIndex
CREATE INDEX "vendor_quotations_vendor_id_idx" ON "vendor_quotations"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_quotations_order_id_idx" ON "vendor_quotations"("order_id");

-- CreateIndex
CREATE INDEX "vendor_quotations_authorisation_status_idx" ON "vendor_quotations"("authorisation_status");

-- CreateIndex
CREATE INDEX "vendor_quotations_quotation_date_idx" ON "vendor_quotations"("quotation_date");

-- CreateIndex
CREATE INDEX "vendor_quotations_deleted_at_idx" ON "vendor_quotations"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_id_key" ON "purchase_orders"("po_id");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_order_id_idx" ON "purchase_orders"("order_id");

-- CreateIndex
CREATE INDEX "purchase_orders_quotation_id_idx" ON "purchase_orders"("quotation_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_approval_status_idx" ON "purchase_orders"("approval_status");

-- CreateIndex
CREATE INDEX "purchase_orders_po_date_idx" ON "purchase_orders"("po_date");

-- CreateIndex
CREATE INDEX "purchase_orders_deleted_at_idx" ON "purchase_orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "gate_passes_gate_pass_no_key" ON "gate_passes"("gate_pass_no");

-- CreateIndex
CREATE INDEX "gate_passes_type_idx" ON "gate_passes"("type");

-- CreateIndex
CREATE INDEX "gate_passes_status_idx" ON "gate_passes"("status");

-- CreateIndex
CREATE INDEX "gate_passes_gate_pass_date_idx" ON "gate_passes"("gate_pass_date");

-- CreateIndex
CREATE INDEX "gate_passes_vendor_id_idx" ON "gate_passes"("vendor_id");

-- CreateIndex
CREATE INDEX "gate_passes_purchase_order_id_idx" ON "gate_passes"("purchase_order_id");

-- CreateIndex
CREATE INDEX "gate_passes_linked_doc_no_idx" ON "gate_passes"("linked_doc_no");

-- CreateIndex
CREATE INDEX "gate_passes_deleted_at_idx" ON "gate_passes"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "grns_grn_no_key" ON "grns"("grn_no");

-- CreateIndex
CREATE INDEX "grns_purchase_order_id_idx" ON "grns"("purchase_order_id");

-- CreateIndex
CREATE INDEX "grns_vendor_id_idx" ON "grns"("vendor_id");

-- CreateIndex
CREATE INDEX "grns_grn_date_idx" ON "grns"("grn_date");

-- CreateIndex
CREATE INDEX "grns_status_idx" ON "grns"("status");

-- CreateIndex
CREATE INDEX "grns_deleted_at_idx" ON "grns"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "grns_purchase_order_id_bill_no_key" ON "grns"("purchase_order_id", "bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_roll_no_key" ON "fabric_rolls"("roll_no");

-- CreateIndex
CREATE INDEX "fabric_rolls_grn_id_idx" ON "fabric_rolls"("grn_id");

-- CreateIndex
CREATE INDEX "fabric_rolls_vendor_id_idx" ON "fabric_rolls"("vendor_id");

-- CreateIndex
CREATE INDEX "fabric_rolls_stage_idx" ON "fabric_rolls"("stage");

-- CreateIndex
CREATE INDEX "fabric_rolls_color_code_idx" ON "fabric_rolls"("color_code");

-- CreateIndex
CREATE INDEX "fabric_rolls_deleted_at_idx" ON "fabric_rolls"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_item_code_key" ON "inventory_items"("item_code");

-- CreateIndex
CREATE INDEX "inventory_items_item_category_idx" ON "inventory_items"("item_category");

-- CreateIndex
CREATE INDEX "inventory_items_is_active_idx" ON "inventory_items"("is_active");

-- CreateIndex
CREATE INDEX "inventory_items_deleted_at_idx" ON "inventory_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_item_category_sub_category_accessories_item_key" ON "inventory_items"("item_category", "sub_category", "accessories_item", "color_code", "gsm", "count", "uom");

-- CreateIndex
CREATE INDEX "stock_balances_item_id_idx" ON "stock_balances"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_item_id_location_key" ON "stock_balances"("item_id", "location");

-- CreateIndex
CREATE INDEX "stock_ledger_item_id_entry_date_idx" ON "stock_ledger"("item_id", "entry_date");

-- CreateIndex
CREATE INDEX "stock_ledger_roll_id_idx" ON "stock_ledger"("roll_id");

-- CreateIndex
CREATE INDEX "stock_ledger_document_type_document_id_idx" ON "stock_ledger"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entry_date_idx" ON "stock_ledger"("entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_issues_issue_no_key" ON "fabric_issues"("issue_no");

-- CreateIndex
CREATE INDEX "fabric_issues_order_id_idx" ON "fabric_issues"("order_id");

-- CreateIndex
CREATE INDEX "fabric_issues_style_id_idx" ON "fabric_issues"("style_id");

-- CreateIndex
CREATE INDEX "fabric_issues_roll_id_idx" ON "fabric_issues"("roll_id");

-- CreateIndex
CREATE INDEX "fabric_issues_purpose_idx" ON "fabric_issues"("purpose");

-- CreateIndex
CREATE INDEX "fabric_issues_issue_date_idx" ON "fabric_issues"("issue_date");

-- CreateIndex
CREATE INDEX "fabric_issues_status_idx" ON "fabric_issues"("status");

-- CreateIndex
CREATE INDEX "fabric_issues_deleted_at_idx" ON "fabric_issues"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "dye_issues_dye_issue_no_key" ON "dye_issues"("dye_issue_no");

-- CreateIndex
CREATE INDEX "dye_issues_vendor_id_idx" ON "dye_issues"("vendor_id");

-- CreateIndex
CREATE INDEX "dye_issues_roll_id_idx" ON "dye_issues"("roll_id");

-- CreateIndex
CREATE INDEX "dye_issues_order_id_idx" ON "dye_issues"("order_id");

-- CreateIndex
CREATE INDEX "dye_issues_process_idx" ON "dye_issues"("process");

-- CreateIndex
CREATE INDEX "dye_issues_issue_date_idx" ON "dye_issues"("issue_date");

-- CreateIndex
CREATE INDEX "dye_issues_deleted_at_idx" ON "dye_issues"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "dyeing_receipts_receipt_no_key" ON "dyeing_receipts"("receipt_no");

-- CreateIndex
CREATE INDEX "dyeing_receipts_dye_issue_id_idx" ON "dyeing_receipts"("dye_issue_id");

-- CreateIndex
CREATE INDEX "dyeing_receipts_roll_id_idx" ON "dyeing_receipts"("roll_id");

-- CreateIndex
CREATE INDEX "dyeing_receipts_status_idx" ON "dyeing_receipts"("status");

-- CreateIndex
CREATE INDEX "dyeing_receipts_receipt_date_idx" ON "dyeing_receipts"("receipt_date");

-- CreateIndex
CREATE INDEX "dyeing_receipts_deleted_at_idx" ON "dyeing_receipts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "printings_printing_no_key" ON "printings"("printing_no");

-- CreateIndex
CREATE INDEX "printings_order_id_idx" ON "printings"("order_id");

-- CreateIndex
CREATE INDEX "printings_style_id_idx" ON "printings"("style_id");

-- CreateIndex
CREATE INDEX "printings_vendor_id_idx" ON "printings"("vendor_id");

-- CreateIndex
CREATE INDEX "printings_fabric_stage_idx" ON "printings"("fabric_stage");

-- CreateIndex
CREATE INDEX "printings_printing_date_idx" ON "printings"("printing_date");

-- CreateIndex
CREATE INDEX "printings_deleted_at_idx" ON "printings"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_scrutinies_scrutiny_no_key" ON "fabric_scrutinies"("scrutiny_no");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_roll_id_idx" ON "fabric_scrutinies"("roll_id");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_order_id_idx" ON "fabric_scrutinies"("order_id");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_style_id_idx" ON "fabric_scrutinies"("style_id");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_decision_idx" ON "fabric_scrutinies"("decision");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_scrutiny_date_idx" ON "fabric_scrutinies"("scrutiny_date");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_deleted_at_idx" ON "fabric_scrutinies"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_approvals_approval_no_key" ON "plan_approvals"("approval_no");

-- CreateIndex
CREATE INDEX "plan_approvals_order_id_idx" ON "plan_approvals"("order_id");

-- CreateIndex
CREATE INDEX "plan_approvals_planning_id_idx" ON "plan_approvals"("planning_id");

-- CreateIndex
CREATE INDEX "plan_approvals_approval_status_idx" ON "plan_approvals"("approval_status");

-- CreateIndex
CREATE INDEX "plan_approvals_submitted_date_idx" ON "plan_approvals"("submitted_date");

-- CreateIndex
CREATE INDEX "plan_approvals_deleted_at_idx" ON "plan_approvals"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_issues_challan_no_key" ON "cutting_issues"("challan_no");

-- CreateIndex
CREATE INDEX "cutting_issues_order_id_idx" ON "cutting_issues"("order_id");

-- CreateIndex
CREATE INDEX "cutting_issues_style_id_idx" ON "cutting_issues"("style_id");

-- CreateIndex
CREATE INDEX "cutting_issues_planning_id_idx" ON "cutting_issues"("planning_id");

-- CreateIndex
CREATE INDEX "cutting_issues_plan_approval_id_idx" ON "cutting_issues"("plan_approval_id");

-- CreateIndex
CREATE INDEX "cutting_issues_issue_date_idx" ON "cutting_issues"("issue_date");

-- CreateIndex
CREATE INDEX "cutting_issues_status_idx" ON "cutting_issues"("status");

-- CreateIndex
CREATE INDEX "cutting_issues_container_no_idx" ON "cutting_issues"("container_no");

-- CreateIndex
CREATE INDEX "cutting_issues_deleted_at_idx" ON "cutting_issues"("deleted_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_list_values" ADD CONSTRAINT "master_list_values_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "master_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_bom_lines" ADD CONSTRAINT "style_bom_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plannings" ADD CONSTRAINT "plannings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_lines" ADD CONSTRAINT "planning_lines_planning_id_fkey" FOREIGN KEY ("planning_id") REFERENCES "plannings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "vendor_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_dye_issue_id_fkey" FOREIGN KEY ("dye_issue_id") REFERENCES "dye_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_cutting_issue_id_fkey" FOREIGN KEY ("cutting_issue_id") REFERENCES "cutting_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_gate_pass_id_fkey" FOREIGN KEY ("gate_pass_id") REFERENCES "gate_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_issues" ADD CONSTRAINT "fabric_issues_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_issues" ADD CONSTRAINT "fabric_issues_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_issues" ADD CONSTRAINT "fabric_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_issues" ADD CONSTRAINT "fabric_issues_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_issues" ADD CONSTRAINT "fabric_issues_issued_by_employee_id_fkey" FOREIGN KEY ("issued_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dye_issues" ADD CONSTRAINT "dye_issues_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dye_issues" ADD CONSTRAINT "dye_issues_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dye_issues" ADD CONSTRAINT "dye_issues_fabric_issue_id_fkey" FOREIGN KEY ("fabric_issue_id") REFERENCES "fabric_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dye_issues" ADD CONSTRAINT "dye_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dyeing_receipts" ADD CONSTRAINT "dyeing_receipts_dye_issue_id_fkey" FOREIGN KEY ("dye_issue_id") REFERENCES "dye_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dyeing_receipts" ADD CONSTRAINT "dyeing_receipts_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printings" ADD CONSTRAINT "printings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printings" ADD CONSTRAINT "printings_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printings" ADD CONSTRAINT "printings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_scrutinies" ADD CONSTRAINT "fabric_scrutinies_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_scrutinies" ADD CONSTRAINT "fabric_scrutinies_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_scrutinies" ADD CONSTRAINT "fabric_scrutinies_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_scrutinies" ADD CONSTRAINT "fabric_scrutinies_checked_by_employee_id_fkey" FOREIGN KEY ("checked_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_approvals" ADD CONSTRAINT "plan_approvals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_approvals" ADD CONSTRAINT "plan_approvals_planning_id_fkey" FOREIGN KEY ("planning_id") REFERENCES "plannings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_issues" ADD CONSTRAINT "cutting_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_issues" ADD CONSTRAINT "cutting_issues_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_issues" ADD CONSTRAINT "cutting_issues_planning_id_fkey" FOREIGN KEY ("planning_id") REFERENCES "plannings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_issues" ADD CONSTRAINT "cutting_issues_plan_approval_id_fkey" FOREIGN KEY ("plan_approval_id") REFERENCES "plan_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_issues" ADD CONSTRAINT "cutting_issues_fabric_issue_id_fkey" FOREIGN KEY ("fabric_issue_id") REFERENCES "fabric_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

