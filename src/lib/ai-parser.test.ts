import { describe, expect, it, vi, afterEach } from "vitest";
import { parseCargoEmail } from "./ai-parser";

afterEach(() => vi.unstubAllGlobals());

describe("AI cargo parser", () => {
  it("extracts structured cargo data from an OpenAI-compatible model response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Container release delayed at Rotterdam", category: "shipment_delay", priority: "high", customerName: "Asha Mehta", company: "Acme Logistics", shipmentReference: "MSCU1234567", origin: "Shanghai", destination: "Rotterdam", requestedAction: "Confirm the release date and next steps", confidence: 0.96 }) } }] }), { status: 200 })));
    const result = await parseCargoEmail({ messageId: "test-1", from: "asha@example.com", to: "support@example.com", subject: "Container delay", text: "Our container MSCU1234567 is delayed at Rotterdam.", references: [] });
    expect(result.category).toBe("shipment_delay");
    expect(result.shipmentReference).toBe("MSCU1234567");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/chat/completions"), expect.anything());
  });
});
