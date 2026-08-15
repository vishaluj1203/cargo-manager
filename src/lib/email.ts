import { z } from "zod";

export const inboundEmailSchema = z.object({
  messageId: z.string().min(1), from: z.string().email(), to: z.string().email().or(z.string().min(1)), subject: z.string().default("Cargo support request"), text: z.string().min(1), html: z.string().optional(), inReplyTo: z.string().optional(), references: z.array(z.string()).default([]), receivedAt: z.coerce.date().optional()
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export function normalizeSubject(subject: string) { return subject.replace(/^\s*((re|fw|fwd):\s*)+/gi, "").trim() || "Cargo support request"; }
export function ticketNumber(sequence: number) { return `CAR-${String(sequence).padStart(6, "0")}`; }
export function isReply(email: InboundEmail) { return Boolean(email.inReplyTo || email.references.length); }
