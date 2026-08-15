import { describe, expect, it } from "vitest";
import { cargoExtractionSchema, normalizedEmailSchema } from "./index";

describe("shared contracts", () => {
  it("rejects an invented confidence outside the supported range", () => {
    const result = cargoExtractionSchema.safeParse({
      category: "booking",
      priority: "normal",
      summary: "Booking request",
      customerName: null,
      company: null,
      shipmentReferences: [],
      origin: null,
      destination: null,
      requestedAction: "Confirm space",
      deadline: null,
      missingInformation: [],
      confidence: 1.2,
    });
    expect(result.success).toBe(false);
  });

  it("accepts normalized local email", () => {
    const result = normalizedEmailSchema.safeParse({
      provider: "local_mailpit",
      providerMessageId: "mailpit-1",
      providerThreadId: null,
      messageId: "<mailpit-1@example.com>",
      inReplyTo: null,
      references: [],
      from: { name: "Customer", address: "customer@example.com" },
      to: [{ name: null, address: "cargo@skyvalence.local" }],
      cc: [],
      subject: "Container delayed",
      text: "Please advise about container ABCD1234567.",
      html: null,
      receivedAt: new Date(),
      rawObjectKey: null,
    });
    expect(result.success).toBe(true);
  });
});
