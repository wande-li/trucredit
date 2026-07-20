-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "CreditGrade" AS ENUM ('A_PLUS', 'A', 'B', 'C', 'D', 'F');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'FROZEN', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "CreditAction" AS ENUM ('SET_LIMIT', 'ADJUST_LIMIT', 'FREEZE', 'SET_GRADE', 'SET_TERMS');

-- CreateEnum
CREATE TYPE "CreditEventType" AS ENUM ('LIMIT_CHANGE', 'GRADE_CHANGE', 'FROZEN', 'UNFROZEN', 'SCORE_UPDATE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'VOID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('BEFORE_DUE', 'ON_DUE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('EMAIL_SENT', 'SMS_SENT', 'REPLY_RECEIVED', 'PAYMENT_RECEIVED', 'INTENT_DETECTED', 'ESCALATED', 'FROZEN', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('WILL_PAY', 'ALREADY_PAID', 'DISPUTE', 'PAYMENT_PLAN', 'DELAY_REQUEST', 'CANNOT_PAY', 'UNRELATED');

-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('REMINDER_BEFORE_DUE', 'REMINDER_ON_DUE', 'COLLECTION_GENTLE', 'COLLECTION_FIRM', 'COLLECTION_URGENT', 'COLLECTION_FINAL', 'PAYMENT_RECEIVED', 'CREDIT_APPROVED', 'CREDIT_FROZEN', 'CUSTOM');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "accessTokenExpires" TIMESTAMP(3),
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "emailFromName" TEXT,
    "emailReplyTo" TEXT,
    "shopifyChargeId" TEXT,
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'NONE',
    "billingInterval" TEXT,
    "priceAmount" DOUBLE PRECISION,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialDays" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "customerQuota" INTEGER NOT NULL DEFAULT 5,
    "invoiceQuota" INTEGER NOT NULL DEFAULT 10,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditUsed" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditAvailable" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditScore" INTEGER,
    "creditGrade" "CreditGrade",
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avgPaymentDays" DOUBLE PRECISION,
    "onTimePaymentRate" DOUBLE PRECISION,
    "lastPaymentDate" TIMESTAMP(3),
    "netTermsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "action" "CreditAction" NOT NULL,
    "actionValue" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CreditEventType" NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "shopifyDraftOrderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "netTermsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "daysOverdue" INTEGER NOT NULL DEFAULT 0,
    "paymentUrl" TEXT,
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSequence" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" "TriggerType" NOT NULL DEFAULT 'OVERDUE',
    "triggerDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'EMAIL',
    "toneLevel" INTEGER NOT NULL DEFAULT 3,
    "subject" TEXT,
    "templateId" TEXT,
    "useAI" BOOLEAN NOT NULL DEFAULT true,
    "aiPromptHint" TEXT,
    "skipIfPaid" BOOLEAN NOT NULL DEFAULT true,
    "skipConditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextStepAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "lastReplyIntent" "ReplyIntent",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedReason" TEXT,

    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "channel" "Channel",
    "stepOrder" INTEGER,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "emailMessageId" TEXT,
    "toneLevel" INTEGER,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "replyContent" TEXT,
    "replyIntent" "ReplyIntent",
    "replyConfidence" DOUBLE PRECISION,
    "aiAnalysis" JSONB,
    "actionTaken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TemplateType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "toneLevel" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Session_shop_isOnline_idx" ON "Session"("shop", "isOnline");

-- CreateIndex
CREATE INDEX "Session_refreshTokenExpires_idx" ON "Session"("refreshTokenExpires");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Shop_plan_idx" ON "Shop"("plan");

-- CreateIndex
CREATE INDEX "Shop_uninstalledAt_idx" ON "Shop"("uninstalledAt");

-- CreateIndex
CREATE INDEX "Customer_shopId_status_idx" ON "Customer"("shopId", "status");

-- CreateIndex
CREATE INDEX "Customer_shopId_creditGrade_idx" ON "Customer"("shopId", "creditGrade");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopId_shopifyCustomerId_key" ON "Customer"("shopId", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CreditRule_shopId_isActive_idx" ON "CreditRule"("shopId", "isActive");

-- CreateIndex
CREATE INDEX "Invoice_shopId_status_idx" ON "Invoice"("shopId", "status");

-- CreateIndex
CREATE INDEX "Invoice_shopId_dueDate_idx" ON "Invoice"("shopId", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");

-- CreateIndex
CREATE INDEX "CollectionSequence_shopId_isActive_idx" ON "CollectionSequence"("shopId", "isActive");

-- CreateIndex
CREATE INDEX "CollectionTask_status_nextStepAt_idx" ON "CollectionTask"("status", "nextStepAt");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditRule" ADD CONSTRAINT "CreditRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditEvent" ADD CONSTRAINT "CreditEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSequence" ADD CONSTRAINT "CollectionSequence_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStep" ADD CONSTRAINT "CollectionStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CollectionSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CollectionSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEvent" ADD CONSTRAINT "CollectionEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

