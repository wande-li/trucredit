// Invoice & AR type definitions — mirrors Prisma schema

import type { InvoiceStatus } from "@prisma/client";

export type { InvoiceStatus };

// Full invoice record from DB
export interface InvoiceRecord {
  id: string;
  shopId: string;
  customerId: string;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
  shopifyDraftOrderId: string | null;
  invoiceNumber: string;
  amount: string; // Decimal → string
  currency: string;
  issueDate: Date;
  dueDate: Date;
  paidDate: Date | null;
  voidedAt?: Date | null;
  netTermsDays: number;
  status: InvoiceStatus;
  daysOverdue: number;
  paymentUrl: string | null;
  paymentMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Invoice summary for list views
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerCompany: string | null;
  amount: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  daysOverdue: number;
  netTermsDays: number;
}

// AR Aging bucket
export interface AgingBucket {
  label: string; // "Current", "1-30", "31-60", "61-90", "90+"
  minDays: number | null; // null = unbounded
  maxDays: number | null;
  count: number;
  totalAmount: string;
  invoices: InvoiceSummary[];
}

// AR Aging report
export interface ARAgingReport {
  shopId: string;
  totalOutstanding: string;
  totalOverdue: string;
  totalCustomers: number;
  totalInvoices: number;
  buckets: AgingBucket[];
  dso: number | null; // Days Sales Outstanding
}

// Generate invoice number
export function generateInvoiceNumber(seq: number): string {
  const padded = String(seq).padStart(6, "0");
  return `INV-${padded}`;
}

// Calculate overdue days from due date
export function calcOverdueDays(dueDate: Date, reference: Date = new Date()): number {
  const diffMs = reference.getTime() - dueDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Valid invoice status transitions
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["PENDING", "VOID"],
  PENDING: ["OVERDUE", "PARTIALLY_PAID", "PAID", "DISPUTED", "VOID"],
  OVERDUE: ["PARTIALLY_PAID", "PAID", "DISPUTED", "VOID"],
  PARTIALLY_PAID: ["PAID", "DISPUTED", "VOID"],
  PAID: ["DISPUTED"],
  VOID: [],
  DISPUTED: ["PENDING", "OVERDUE", "PAID", "VOID"],
};
