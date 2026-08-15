import { z } from "zod";
import type { InboundEmail } from "./email";

const cargoExtractionSchema = z.object({
  summary: z.string().min(1).max(500),
  category: z.enum(["shipment_delay", "booking", "documentation", "customs", "billing", "damage_claim", "tracking", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  customerName: z.string().nullable(),
  company: z.string().nullable(),
  shipmentReference: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  requestedAction: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1)
});

export type CargoExtraction = z.infer<typeof cargoExtractionSchema>;

const SYSTEM_PROMPT = `You extract structured cargo support data from an email. Return ONLY valid JSON, no markdown and no explanation. Never invent values: use null when a value is absent. Classify priority based on operational urgency: urgent means cargo is stopped, customs deadline is immediate, or a major loss is happening; high means a material delay or risk; normal is a routine request; low is informational.\n\nJSON keys: summary (short issue summary), category (shipment_delay|booking|documentation|customs|billing|damage_claim|tracking|other), priority (low|normal|high|urgent), customerName, company, shipmentReference (AWB, booking, container, or other reference), origin, destination, requestedAction (what the customer needs), confidence (0 to 1).`;

function endpoint() { return (process.env.AI_BASE_URL ?? "http://localhost:11434/v1").replace(/\/$/, ""); }

function parseJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI did not return a JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function parseCargoEmail(email: InboundEmail): Promise<CargoExtraction> {
  const response = await fetch(`${endpoint()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}) },
    body: JSON.stringify({ model: process.env.AI_MODEL ?? "qwen2.5:1.5b-instruct", temperature: 0, max_tokens: 500, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.text}` }] })
  });
  if (!response.ok) throw new Error(`AI parser returned HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI parser returned no content");
  return cargoExtractionSchema.parse(parseJson(content));
}

export { cargoExtractionSchema };
