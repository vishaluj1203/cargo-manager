import { describe, expect, it, vi } from "vitest";

import {
  buildExtractionContext,
  createCargoExtractorFromEnv,
  FakeCargoExtractor,
  GoogleGemmaCargoExtractor,
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

function gemmaResponse(args: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                functionCall: {
                  name: "record_cargo_email_extraction",
                  args,
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

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

  it("forces and validates a Gemma extraction function call", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(gemmaResponse(fixture));
    const extractor = new GoogleGemmaCargoExtractor({
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
    expect(result.provider).toBe("google-gemini-api");
    const [url, init] = fetcher.mock.calls[0] ?? [];
    const request = JSON.parse(String(init?.body));
    expect(String(url)).toContain("/models/gemma-4-26b-a4b-it:generateContent");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
    expect(request.toolConfig.functionCallingConfig.mode).toBe("ANY");
    expect(request.tools[0].functionDeclarations[0].name).toBe(
      "record_cargo_email_extraction",
    );
    expect(
      JSON.stringify(request.tools[0].functionDeclarations[0].parameters),
    ).not.toContain("additionalProperties");
    expect(request.generationConfig.thinkingConfig.thinkingLevel).toBe(
      "minimal",
    );
  });

  it("retries once when Gemma returns schema-invalid arguments", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(gemmaResponse({ ...fixture, confidence: 8 }))
      .mockResolvedValueOnce(gemmaResponse(fixture));
    const extractor = new GoogleGemmaCargoExtractor({
      apiKey: "test-key",
      fetcher,
    });

    const result = await extractor.extract({
      subject: "Container status",
      sender: "maya@example.com",
      receivedAt: new Date("2026-08-16T00:00:00Z"),
      latestMessage: "Please confirm container status.",
    });

    expect(result.extraction).toEqual(fixture);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(retry.contents[0].parts[0].text).toContain(
      "<validation_correction>",
    );
  });

  it("fails closed when Google rejects the request instead of using defaults", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "invalid API key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      );
    const extractor = new GoogleGemmaCargoExtractor({
      apiKey: "invalid-test-key",
      fetcher,
    });

    await expect(
      extractor.extract({
        subject: "Booking request",
        sender: "customer@example.com",
        receivedAt: new Date("2026-08-16T00:00:00Z"),
        latestMessage: "Please book one pallet from Chennai to Dubai.",
      }),
    ).rejects.toThrow("Google Gemini API request failed (401)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never selects the fake extractor from environment configuration", () => {
    expect(() =>
      createCargoExtractorFromEnv({
        AI_PROVIDER: "fake",
        AI_API_KEY: "unused",
      }),
    ).toThrow("Unsupported AI_PROVIDER: fake");

    expect(
      createCargoExtractorFromEnv({
        AI_PROVIDER: "google",
        AI_API_KEY: "configured-key",
      }),
    ).toBeInstanceOf(GoogleGemmaCargoExtractor);
  });
});
