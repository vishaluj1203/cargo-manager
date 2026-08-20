import { z } from "zod";

export const ticketStatusSchema = z.enum([
  "new",
  "needs_verification",
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
]);

export const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const ticketCategorySchema = z.enum([
  "booking",
  "documentation",
  "shipment_status",
  "delay_exception",
  "customs_hold",
  "pickup_delivery",
  "billing",
  "damage_claim",
  "other",
]);

export const cargoExtractionSchema = z.object({
  category: ticketCategorySchema,
  priority: ticketPrioritySchema,
  summary: z.string().min(1).max(800),
  customerName: z.string().nullable(),
  company: z.string().nullable(),
  shipmentReferences: z.array(
    z.object({
      type: z.enum(["awb", "bill_of_lading", "booking", "container", "other"]),
      value: z.string().min(1),
      evidence: z.string().min(1),
    }),
  ),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  requestedAction: z.string().min(1).max(800),
  deadline: z.string().nullable(),
  missingInformation: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const enquiryClassificationSchema = z.object({
  decision: z.enum([
    "new_quote_enquiry",
    "existing_quote_follow_up",
    "non_enquiry",
    "uncertain",
  ]),
  reason: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(300)).max(8),
  confidence: z.number().min(0).max(1),
});

export const enquiryDetectionPolicySchema = z.object({
  minimumConfidence: z.number().min(0.5).max(0.99),
  acceptExistingQuoteFollowUps: z.boolean(),
  uncertainAction: z.enum(["review", "ignore"]),
});

export const defaultEnquiryDetectionPolicy = {
  minimumConfidence: 0.75,
  acceptExistingQuoteFollowUps: true,
  uncertainAction: "review",
} as const satisfies z.infer<typeof enquiryDetectionPolicySchema>;

export const normalizedEmailSchema = z.object({
  provider: z.enum(["local_mailpit", "gmail"]),
  providerMessageId: z.string().min(1),
  providerThreadId: z.string().nullable(),
  messageId: z.string().min(1),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  from: z.object({
    name: z.string().nullable(),
    address: z.string().email(),
  }),
  to: z.array(
    z.object({
      name: z.string().nullable(),
      address: z.string().email(),
    }),
  ),
  cc: z.array(
    z.object({
      name: z.string().nullable(),
      address: z.string().email(),
    }),
  ),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().nullable(),
  receivedAt: z.coerce.date(),
  rawObjectKey: z.string().nullable(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  companyType: z.enum(["freight_forwarder", "broker", "operator", "other"]),
  timezone: z.string().min(1),
  modes: z.array(z.enum(["air", "ocean", "road", "rail"])).min(1),
});

export const replyDraftSchema = z.object({
  bodyText: z.string().trim().min(1).max(20_000),
  cc: z.array(z.string().email()).default([]),
});

export type CargoExtraction = z.infer<typeof cargoExtractionSchema>;
export type EnquiryClassification = z.infer<typeof enquiryClassificationSchema>;
export type EnquiryDetectionPolicy = z.infer<
  typeof enquiryDetectionPolicySchema
>;
export type NormalizedEmail = z.infer<typeof normalizedEmailSchema>;
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export type TicketCategory = z.infer<typeof ticketCategorySchema>;
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>;
export type ReplyDraft = z.infer<typeof replyDraftSchema>;
