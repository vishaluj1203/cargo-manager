import { describe, expect, it, vi } from "vitest";

import {
  buildExtractionContext,
  FakeCargoExtractor,
  TogetherCargoExtractor,
} from "./index.js";

const fixture = {
  category: "shipment_status" as const,
  priority: "high" as const,
  summary: "Customer requests urgent status for container TCLU1234567.",
  customerName: "Maya Chen",
  company: "North Star Imports",
  shipmentReferences: [
    {
      type: "container" as const,
      value: "TCLU1234567",
      evidence: "container TCLU1234567",
    },
  ],
  origin: "Singapore",
  destination: "Rotterdam",
  requestedAction:
    "Confirm current location and whether Friday delivery remains possible.",
  deadline: "2026-08-21",
  missingInformation: [],
  confidence: 0.96,
};

describe("cargo AI adapter", () => {
  it("bounds untrusted email context", () => {
    const context = buildExtractionContext({
      subject: "Status",
      sender: "maya@example.com",
      receivedAt: new Date("2026-08-16T00:00:00Z"),
      latestMessage: "x".repeat(30_000),
    });

    expect(context).toContain("[content truncated by Cargo Manager]");
    expect(context).toContain("<latest_email>");
    expect(context.length).toBeLessThan(26_000);
  });

  it("uses deterministic fixtures without pretending they are AI parsing", async () => {
    const extractor = new FakeCargoExtractor(fixture);
    await expect(
      extractor.extract({
        subject: "Status",
        sender: "maya@example.com",
        receivedAt: new Date(),
        latestMessage: "hello",
      }),
    ).resolves.toMatchObject({ extraction: fixture, provider: "fake" });
  });

  it("requests and validates Together structured output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(fixture) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const extractor = new TogetherCargoExtractor({
      apiKey: "test-key",
      fetcher,
    });

    const result = await extractor.extract({
      subject: "Where is our container?",
      sender: "maya@example.com",
      receivedAt: new Date("2026-08-16T00:00:00Z"),
      latestMessage: "Please confirm container status.",
    });

    expect(result.extraction).toEqual(fixture);
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("Qwen/Qwen3.5-9B");
    expect(request.response_format.type).toBe("json_schema");
    expect(request.reasoning).toEqual({ enabled: false });
  });
});
