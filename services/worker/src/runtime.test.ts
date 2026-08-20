import type { CargoExtractor } from "@cargo/ai";
import type { NormalizedEmail } from "@cargo/contracts";
import type { EmailProvider, ParsedInboundEmail } from "@cargo/email";
import { describe, expect, it, vi } from "vitest";

import { CargoWorkerRuntime } from "./runtime.js";
import type { ClaimedInboundEvent, WorkerRepository } from "./types.js";

const normalizedEmail: NormalizedEmail = {
  provider: "local_mailpit",
  providerMessageId: "mailpit-1",
  providerThreadId: null,
  messageId: "<customer-1@example.com>",
  inReplyTo: null,
  references: [],
  from: { name: "Maya", address: "maya@example.com" },
  to: [{ name: "Cargo", address: "cargo@skyvalence.local" }],
  cc: [],
  subject: "Container status",
  text: "Please update us about container TCLU1234567.",
  html: null,
  receivedAt: new Date("2026-08-16T05:00:00Z"),
  rawObjectKey: null,
};

function fixtureExtraction() {
  return {
    category: "shipment_status" as const,
    priority: "normal" as const,
    summary: "Customer requests container status.",
    customerName: "Maya",
    company: null,
    shipmentReferences: [
      {
        type: "container" as const,
        value: "TCLU1234567",
        evidence: "container TCLU1234567",
      },
    ],
    origin: null,
    destination: null,
    requestedAction: "Provide current container status.",
    deadline: null,
    missingInformation: [],
    confidence: 0.94,
  };
}

describe("cargo worker runtime", () => {
  it("discovers, stores, AI-extracts and persists an inbound email", async () => {
    const event: ClaimedInboundEvent = {
      id: "event-1",
      organizationId: "org-1",
      inboxConnectionId: "inbox-1",
      provider: "local_mailpit",
      address: "cargo@skyvalence.local",
      encryptedRefreshToken: null,
      grantedScopes: [],
      providerMessageId: "mailpit-1",
      attempts: 1,
    };
    let claimed = false;
    const repository: WorkerRepository = {
      listConnectedInboxes: vi.fn().mockResolvedValue([
        {
          id: "inbox-1",
          organizationId: "org-1",
          provider: "local_mailpit",
          address: "cargo@skyvalence.local",
          encryptedRefreshToken: null,
          grantedScopes: [],
        },
      ]),
      enqueueInbound: vi.fn().mockResolvedValue(true),
      claimInbound: vi
        .fn()
        .mockImplementation(async () =>
          claimed ? null : ((claimed = true), event),
        ),
      persistInbound: vi.fn().mockResolvedValue({
        ticketId: "ticket-1",
        ticketNumber: "CAR-000001",
        duplicate: false,
      }),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    };
    const parsed: ParsedInboundEmail = {
      email: normalizedEmail,
      raw: Buffer.from("raw"),
      attachmentText: [],
    };
    const emailProvider: EmailProvider = {
      listMessages: vi.fn().mockResolvedValue([
        {
          providerMessageId: "mailpit-1",
          rfcMessageId: normalizedEmail.messageId,
          createdAt: normalizedEmail.receivedAt,
          recipients: ["cargo@skyvalence.local"],
        },
      ]),
      fetchAndParse: vi.fn().mockResolvedValue(parsed),
      sendReply: vi.fn(),
    };
    const extractor: CargoExtractor = {
      extract: vi.fn().mockResolvedValue({
        extraction: fixtureExtraction(),
        provider: "fake",
        model: "fixture",
        promptVersion: "v1",
        schemaVersion: "v1",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };
    const rawStore = {
      put: vi.fn().mockResolvedValue("org-1/local_mailpit/mailpit-1.eml"),
    };
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      extractor,
      rawStore,
      "test-worker",
    );

    await expect(runtime.runOnce()).resolves.toEqual({
      discovered: 1,
      inboundProcessed: 1,
      inboundFailed: 0,
      repliesSent: 0,
      repliesFailed: 0,
    });
    expect(rawStore.put).toHaveBeenCalledWith(
      "org-1",
      "local_mailpit",
      "mailpit-1",
      Buffer.from("raw"),
    );
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({ latestMessage: normalizedEmail.text }),
    );
    expect(repository.persistInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        event,
        parsed,
        rawObjectPath: "org-1/local_mailpit/mailpit-1.eml",
      }),
    );
  });

  it("marks failed AI processing for retry", async () => {
    const event: ClaimedInboundEvent = {
      id: "event-1",
      organizationId: "org-1",
      inboxConnectionId: "inbox-1",
      provider: "local_mailpit",
      address: "cargo@skyvalence.local",
      encryptedRefreshToken: null,
      grantedScopes: [],
      providerMessageId: "mailpit-1",
      attempts: 1,
    };
    const repository = {
      listConnectedInboxes: vi.fn().mockResolvedValue([]),
      enqueueInbound: vi.fn(),
      claimInbound: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      persistInbound: vi.fn(),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    } satisfies WorkerRepository;
    const emailProvider = {
      listMessages: vi.fn(),
      fetchAndParse: vi.fn().mockResolvedValue({
        email: normalizedEmail,
        raw: Buffer.from("raw"),
        attachmentText: [],
      }),
      sendReply: vi.fn(),
    } satisfies EmailProvider;
    const failure = new Error("AI unavailable");
    const extractor = {
      extract: vi.fn().mockRejectedValue(failure),
    } satisfies CargoExtractor;
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      extractor,
      { put: vi.fn().mockResolvedValue("raw.eml") },
    );

    const summary = await runtime.runOnce();
    expect(summary.inboundFailed).toBe(1);
    expect(repository.failInbound).toHaveBeenCalledWith(event, failure);
  });

  it("marks database persistence failures for retry", async () => {
    const event: ClaimedInboundEvent = {
      id: "event-db-failure",
      organizationId: "org-1",
      inboxConnectionId: "inbox-1",
      provider: "local_mailpit",
      address: "cargo@skyvalence.local",
      encryptedRefreshToken: null,
      grantedScopes: [],
      providerMessageId: "mailpit-db-failure",
      attempts: 1,
    };
    const failure = new Error("database unavailable");
    const repository = {
      listConnectedInboxes: vi.fn().mockResolvedValue([]),
      enqueueInbound: vi.fn(),
      claimInbound: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      persistInbound: vi.fn().mockRejectedValue(failure),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    } satisfies WorkerRepository;
    const emailProvider = {
      listMessages: vi.fn(),
      fetchAndParse: vi.fn().mockResolvedValue({
        email: {
          ...normalizedEmail,
          providerMessageId: event.providerMessageId,
        },
        raw: Buffer.from("raw"),
        attachmentText: [],
      }),
      sendReply: vi.fn(),
    } satisfies EmailProvider;
    const extractor = {
      extract: vi.fn().mockResolvedValue({
        extraction: fixtureExtraction(),
        provider: "test-provider",
        model: "test-model",
        promptVersion: "v1",
        schemaVersion: "v1",
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    } satisfies CargoExtractor;
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      extractor,
      { put: vi.fn().mockResolvedValue("raw.eml") },
    );

    const summary = await runtime.runOnce();
    expect(summary.inboundFailed).toBe(1);
    expect(repository.persistInbound).toHaveBeenCalledOnce();
    expect(repository.failInbound).toHaveBeenCalledWith(event, failure);
  });
});
