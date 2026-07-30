// Registration Service — B2B self-registration + cold-start credit assessment
import type { ColdStartProfile } from "~/types/credit";
import { coldStartCreditAssessment, scoreToGrade } from "~/services/credit.server";
import { COLD_START_THRESHOLDS } from "~/lib/constants";
import { generatePortalToken, buildPortalUrl } from "~/services/token.server";
import { sendSimpleEmail } from "~/services/email-delivery.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";
import { z } from "zod";

/** Zod schema for public registration form input */
export const RegisterSchema = z.object({
  shopDomain: z.string().min(1, "Store domain is required"),
  companyName: z.string().min(2, "Company name must be at least 2 characters").max(200),
  contactEmail: z.string().email("A valid email address is required").max(200),
  yearsInBusiness: z.number().int().min(0, "Years in business must be 0 or more").max(100),
  companySize: z.string().min(1, "Company size is required").max(50),
  annualRevenue: z.number().min(0, "Annual revenue must be 0 or more"),
  requestedCredit: z.number().min(0, "Requested credit must be 0 or more"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export interface SubmitApplicationResult {
  applicationId: string;
  status: "APPROVED" | "PENDING";
  creditLimit?: number;
  portalUrl?: string;
  message: string;
}

export interface SubmitApplicationError {
  error: string;
}

export async function submitCreditApplication(input: {
  shopId: string;
  companyName: string;
  contactEmail: string;
  yearsInBusiness: number;
  companySize: string;
  annualRevenue: number;
  requestedCredit: number;
}): Promise<SubmitApplicationResult | SubmitApplicationError> {
  // Check for duplicate: same email within cooldown period (any status)
  const recentDuplicate = await prisma.creditApplication.findFirst({
    where: {
      shopId: input.shopId,
      contactEmail: input.contactEmail,
      status: { in: ["PENDING", "REJECTED", "APPROVED"] },
      createdAt: {
        gte: new Date(Date.now() - COLD_START_THRESHOLDS.REAPPLY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000),
      },
    },
  });
  if (recentDuplicate) {
    return { error: "An application from this email is already being reviewed. Please wait before reapplying." };
  }

  // Run cold-start scoring
  const profile: ColdStartProfile = {
    yearsInBusiness: input.yearsInBusiness,
    companySize: input.companySize,
    annualRevenue: input.annualRevenue,
    requestedCredit: input.requestedCredit,
  };
  const result = coldStartCreditAssessment(profile);

  // Create application record
  const application = await prisma.creditApplication.create({
    data: {
      shopId: input.shopId,
      companyName: input.companyName,
      contactEmail: input.contactEmail,
      yearsInBusiness: input.yearsInBusiness,
      companySize: input.companySize,
      annualRevenue: input.annualRevenue,
      requestedCredit: input.requestedCredit,
      coldStartScore: result.score,
      coldStartComponents: JSON.parse(JSON.stringify(result.components)),
      autoApproved: result.autoApproved,
      status: result.autoApproved ? "APPROVED" : "PENDING",
      approvedLimit: result.autoApproved ? result.recommendedLimit : null,
    },
  });

  // If auto-approved, create Customer record immediately
  if (result.autoApproved) {
    const customer = await prisma.$transaction(async (tx) => {
      const cust = await tx.customer.create({
        data: {
          shopId: input.shopId,
          shopifyCustomerId: `coldstart_${application.id}`,
          email: input.contactEmail,
          name: input.companyName,
          company: input.companyName,
          creditLimit: result.recommendedLimit,
          creditAvailable: result.recommendedLimit,
          creditScore: result.score,
          creditGrade: scoreToGrade(result.score),
          riskLevel: "MEDIUM",
          yearsInBusiness: input.yearsInBusiness,
          companySize: input.companySize,
          annualRevenue: input.annualRevenue,
          creditSource: "COLD_START",
          status: "ACTIVE",
        },
      });

      await tx.creditApplication.update({
        where: { id: application.id },
        data: { customerId: cust.id },
      });

      return cust;
    });

    // Generate portal access token
    const portalToken = await generatePortalToken({ shopId: input.shopId, customerId: customer.id });
    const portalUrl = buildPortalUrl(portalToken);

    // Send approval email to buyer (non-blocking)
    try {
      await sendSimpleEmail({
        shopId: input.shopId,
        toEmail: input.contactEmail,
        subject: "Your Net Terms Application Has Been Approved",
        htmlBody: `<p>Congratulations! Your Net Terms application for <strong>${input.companyName}</strong> has been approved.</p>
<p><strong>Credit Limit:</strong> $${result.recommendedLimit.toLocaleString()}</p>
<p><strong>Access Your Portal:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
<p>You can view your invoices, payment history, and account statements in the portal.</p>`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "registration.autoApproved — approval email failed", msg);
    }

    logger.app("INFO", "registration.autoApproved", null, {
      applicationId: application.id,
      customerId: customer.id,
      score: result.score,
      limit: result.recommendedLimit,
    });
    logger.metrics("registration.approved", 1, { shopId: input.shopId, type: "auto" });

    return {
      applicationId: application.id,
      status: "APPROVED",
      creditLimit: result.recommendedLimit,
      portalUrl,
      message: `Congratulations! Your credit application has been approved. Your credit limit is $${result.recommendedLimit.toLocaleString()}.`,
    };
  }

  // Notify merchant about new pending application (non-blocking)
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: input.shopId },
      select: { emailReplyTo: true, shopDomain: true },
    });
    if (shop?.emailReplyTo) {
      await sendSimpleEmail({
        shopId: input.shopId,
        toEmail: shop.emailReplyTo,
        subject: `New Credit Application — ${input.companyName}`,
        htmlBody: `<p>A new credit application has been submitted for review.</p>
<p><strong>Company:</strong> ${input.companyName}</p>
<p><strong>Contact:</strong> ${input.contactEmail}</p>
<p><strong>Requested Credit:</strong> $${input.requestedCredit.toLocaleString()}</p>
<p><strong>Years in Business:</strong> ${input.yearsInBusiness}</p>
<p><strong>Cold-Start Score:</strong> ${result.score}</p>
<p><a href="${process.env.SHOPIFY_APP_URL || "https://admin.shopify.com"}/app/credit-applications">Review Application →</a></p>`,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "registration.pendingReview — merchant notification failed", msg);
  }

  logger.app("INFO", "registration.pendingReview", null, {
    applicationId: application.id,
    score: result.score,
  });

  return {
    applicationId: application.id,
    status: "PENDING",
    message: "Your application has been submitted for review. The merchant will review your application shortly.",
  };
}

export async function approveApplication(input: {
  applicationId: string;
  shopId: string;
  reviewerId: string;
  customLimit?: number;
}): Promise<{ customerId: string; creditLimit: number; portalUrl: string }> {
  const application = await prisma.creditApplication.findFirst({
    where: { id: input.applicationId, shopId: input.shopId, status: "PENDING" },
  });
  if (!application) throw new Error("Application not found or already processed");

  const approvedLimit = input.customLimit ?? Math.min(
    Number(application.requestedCredit),
    COLD_START_THRESHOLDS.MAX_AUTO_LIMIT_DEFAULT,
  );

  // Create Customer record + update application — atomic
  const customer = await prisma.$transaction(async (tx) => {
    const cust = await tx.customer.create({
      data: {
        shopId: input.shopId,
        shopifyCustomerId: `coldstart_${application.id}`,
        email: application.contactEmail,
        name: application.companyName,
        company: application.companyName,
        creditLimit: approvedLimit,
        creditAvailable: approvedLimit,
        creditScore: application.coldStartScore ?? undefined,
        creditGrade: application.coldStartScore != null ? scoreToGrade(application.coldStartScore) : undefined,
        riskLevel: "MEDIUM",
        yearsInBusiness: application.yearsInBusiness,
        companySize: application.companySize,
        annualRevenue: application.annualRevenue,
        creditSource: "COLD_START",
        status: "ACTIVE",
      },
    });

    await tx.creditApplication.update({
      where: { id: input.applicationId },
      data: {
        status: "APPROVED",
        reviewerId: input.reviewerId,
        reviewedAt: new Date(),
        approvedLimit,
        customerId: cust.id,
      },
    });

    return cust;
  });

  // Generate portal access token
  const portalToken = await generatePortalToken({ shopId: input.shopId, customerId: customer.id });
  const portalUrl = buildPortalUrl(portalToken);

  // Send approval email to buyer (non-blocking)
  try {
    await sendSimpleEmail({
      shopId: input.shopId,
      toEmail: application.contactEmail,
      subject: "Your Net Terms Application Has Been Approved",
      htmlBody: `<p>Your Net Terms application for <strong>${application.companyName}</strong> has been approved.</p>
<p><strong>Credit Limit:</strong> $${approvedLimit.toLocaleString()}</p>
<p><strong>Access Your Portal:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
<p>You can view your invoices, payment history, and account statements in the portal.</p>`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "registration.manuallyApproved — approval email failed", msg);
  }

  logger.app("INFO", "registration.manuallyApproved", null, {
    applicationId: input.applicationId,
    customerId: customer.id,
    limit: approvedLimit,
  });
  logger.metrics("registration.approved", 1, { shopId: input.shopId, type: "manual" });

  return { customerId: customer.id, creditLimit: approvedLimit, portalUrl };
}

export async function rejectApplication(input: {
  applicationId: string;
  shopId: string;
  reviewerId: string;
  notes?: string;
}): Promise<{ status: "REJECTED" }> {
  const application = await prisma.creditApplication.updateMany({
    where: { id: input.applicationId, shopId: input.shopId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewerId: input.reviewerId,
      reviewedAt: new Date(),
      reviewNotes: input.notes ?? null,
    },
  });

  if (application.count === 0) throw new Error("Application not found or already processed");

  logger.app("INFO", "registration.rejected", null, { applicationId: input.applicationId });

  return { status: "REJECTED" };
}

/**
 * Shared action handler for both register routes (public + App Proxy).
 * Parses formData, resolves shop, submits application, returns RegisterFormData.
 */
export async function parseAndSubmitApplication(
  formData: FormData,
  shopDomain: string,
): Promise<{ ok?: boolean; message?: string; status?: "APPROVED" | "PENDING"; creditLimit?: number; portalUrl?: string; error?: string }> {
  if (!shopDomain) {
    return { error: "Missing shop parameter." };
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return { error: "Store not found. Please contact the store owner." };
  }

  try {
    const rawEmail = String(formData.get("contactEmail") || "").trim();
    const rawCompany = String(formData.get("companyName") || "").trim();
    const rawYearsInBusiness = String(formData.get("yearsInBusiness") || "0");
    const rawCompanySize = String(formData.get("companySize") || "");
    const rawAnnualRevenue = String(formData.get("annualRevenue") || "0");
    const rawRequestedCredit = String(formData.get("requestedCredit") || "0");

    // Sanitize: strip angle brackets to prevent XSS, limit length
    const sanitize = (s: string, maxLen = 120): string =>
      s.replace(/[<>]/g, "").substring(0, maxLen);

    // Zod validation
    const parsedInput = RegisterSchema.safeParse({
      shopDomain,
      companyName: sanitize(rawCompany),
      contactEmail: sanitize(rawEmail, 200),
      yearsInBusiness: parseInt(rawYearsInBusiness, 10) || 0,
      companySize: sanitize(rawCompanySize),
      annualRevenue: parseFloat(rawAnnualRevenue) || 0,
      requestedCredit: parseFloat(rawRequestedCredit) || 0,
    });

    if (!parsedInput.success) {
      const firstError = parsedInput.error.errors[0]?.message ?? "Invalid input";
      return { error: firstError };
    }

    const { shopDomain: _, ...validatedInput } = parsedInput.data;

    const result = await submitCreditApplication({
      shopId: shop.id,
      ...validatedInput,
    });

    if ("error" in result) {
      return { error: result.error };
    }

    return {
      ok: true,
      message: result.message,
      status: result.status,
      creditLimit: result.creditLimit,
      portalUrl: result.portalUrl,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "registration.parseAndSubmitApplication — unexpected error", msg);
    return { error: "We encountered an issue processing your application. Please try again or contact the store owner." };
  }
}
