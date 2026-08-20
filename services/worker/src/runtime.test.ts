import type { CargoExtractor, EnquiryClassifier } from "@cargo/ai";
import type { NormalizedEmail } from "@cargo/contracts";
import type { EmailProvider, ParsedInboundEmail } from "@cargo/email";
import { describe, expect, it, vi } from "vitest";

import { CargoWorkerRuntime, routeEnquiryClassification } from "./runtime.js";
import type {
  AutomaticInbox,
  ClaimedInboundEvent,
  ClaimedInboxScan,
  WorkerRepository,
} from "./types.js";

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

function quoteClassifier(): EnquiryClassifier {
  return {
    classify: vi.fn().mockResolvedValue({
      classification: {
        decision: "new_quote_enquiry",
        reason: "Customer requests a freight quote.",
        evidence: ["Please quote"],
        confidence: 0.96,
      },
      provider: "test-provider",
      model: "test-classifier",
      promptVersion: "classifier-v1",
      schemaVersion: "classification-v1",
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
}

const requestedScan: ClaimedInboxScan = {
  scanId: "scan-1",
  id: "inbox-1",
  organizationId: "org-1",
  provider: "local_mailpit",
  address: "cargo@skyvalence.local",
  encryptedRefreshToken: null,
  grantedScopes: [],
  scope: "recent_demo",
  query: 'newer_than:7d subject:"[Cargo Demo]"',
  attempts: 1,
};

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
      listAutomaticInboxes: vi.fn().mockResolvedValue([]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi
        .fn()
        .mockResolvedValueOnce(requestedScan)
        .mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
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
      persistIgnoredInbound: vi.fn(),
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
      quoteClassifier(),
      rawStore,
      "test-worker",
    );

    await expect(runtime.runOnce()).resolves.toEqual({
      automaticInboxesScanned: 0,
      automaticScanFailures: 0,
      scansProcessed: 1,
      scansFailed: 0,
      discovered: 1,
      inboundProcessed: 1,
      inboundIgnored: 0,
      inboundFailed: 0,
      repliesSent: 0,
      repliesFailed: 0,
    });
    expect(emailProvider.listMessages).toHaveBeenCalledWith(500, {
      query: requestedScan.query,
    });
    expect(repository.completeInboxScan).toHaveBeenCalledWith(requestedScan, 1);
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

  it("does not inspect existing mail without a request or a new-mail baseline", async () => {
    const repository = {
      listAutomaticInboxes: vi.fn().mockResolvedValue([]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi.fn().mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
      enqueueInbound: vi.fn(),
      claimInbound: vi.fn().mockResolvedValue(null),
      persistInbound: vi.fn(),
      persistIgnoredInbound: vi.fn(),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    } satisfies WorkerRepository;
    const emailProvider = {
      listMessages: vi.fn(),
      fetchAndParse: vi.fn(),
      sendReply: vi.fn(),
    } satisfies EmailProvider;
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      { extract: vi.fn() },
      quoteClassifier(),
      { put: vi.fn() },
    );

    await expect(runtime.runOnce()).resolves.toMatchObject({
      automaticInboxesScanned: 0,
      automaticScanFailures: 0,
      scansProcessed: 0,
      scansFailed: 0,
      discovered: 0,
    });
    expect(emailProvider.listMessages).not.toHaveBeenCalled();
    expect(repository.enqueueInbound).not.toHaveBeenCalled();
  });

  it("automatically discovers mail newer than the connected inbox baseline", async () => {
    const inbox: AutomaticInbox = {
      id: "gmail-inbox-1",
      organizationId: "org-1",
      provider: "gmail",
      address: "info@skyvalence.com",
      encryptedRefreshToken: "encrypted",
      grantedScopes: [],
      lastSyncedAt: "2026-08-20T12:00:00Z",
    };
    const repository = {
      listAutomaticInboxes: vi.fn().mockResolvedValue([inbox]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi.fn().mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
      enqueueInbound: vi.fn().mockResolvedValue(true),
      claimInbound: vi.fn().mockResolvedValue(null),
      persistInbound: vi.fn(),
      persistIgnoredInbound: vi.fn(),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    } satisfies WorkerRepository;
    const emailProvider = {
      listMessages: vi.fn().mockResolvedValue([
        {
          providerMessageId: "gmail-new-1",
          rfcMessageId: "<gmail-new-1@example.com>",
          createdAt: new Date("2026-08-20T12:01:00Z"),
          recipients: ["info@skyvalence.com"],
        },
      ]),
      fetchAndParse: vi.fn(),
      sendReply: vi.fn(),
    } satisfies EmailProvider;
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      { extract: vi.fn() },
      quoteClassifier(),
      { put: vi.fn() },
      "automatic-test-worker",
      'subject:"[Cargo Demo]"',
    );

    await expect(runtime.discoverNewInbound()).resolves.toMatchObject({
      automaticInboxesScanned: 1,
      automaticScanFailures: 0,
      discovered: 1,
    });
    const listOptions = emailProvider.listMessages.mock.calls[0]?.[1];
    expect(listOptions?.query).toContain("after:");
    expect(listOptions?.query).toContain('subject:"[Cargo Demo]"');
    expect(repository.completeAutomaticScan).toHaveBeenCalledOnce();
  });

  it("routes configurable low-confidence and non-enquiry decisions safely", () => {
    const policy = {
      minimumConfidence: 0.8,
      acceptExistingQuoteFollowUps: true,
      uncertainAction: "review" as const,
    };
    expect(
      routeEnquiryClassification(
        {
          decision: "new_quote_enquiry",
          reason: "Weak quote signal.",
          evidence: ["Can you help?"],
          confidence: 0.6,
        },
        policy,
      ),
    ).toBe("review");
    expect(
      routeEnquiryClassification(
        {
          decision: "non_enquiry",
          reason: "Automated shipment status notification.",
          evidence: ["Container discharged"],
          confidence: 0.99,
        },
        policy,
      ),
    ).toBe("ignore");
  });

  it("stores classification and creates no ticket for a confident non-enquiry", async () => {
    const event: ClaimedInboundEvent = {
      id: "event-non-enquiry",
      organizationId: "org-1",
      inboxConnectionId: "inbox-1",
      provider: "local_mailpit",
      address: "cargo@skyvalence.local",
      encryptedRefreshToken: null,
      grantedScopes: [],
      providerMessageId: "mailpit-non-enquiry",
      attempts: 1,
      enquiryPolicy: {
        minimumConfidence: 0.75,
        acceptExistingQuoteFollowUps: true,
        uncertainAction: "review",
      },
    };
    const repository = {
      listAutomaticInboxes: vi.fn().mockResolvedValue([]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi.fn().mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
      enqueueInbound: vi.fn(),
      claimInbound: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      persistInbound: vi.fn(),
      persistIgnoredInbound: vi.fn(),
      failInbound: vi.fn(),
      claimOutbox: vi.fn().mockResolvedValue(null),
      markOutboxSent: vi.fn(),
      failOutbox: vi.fn(),
      close: vi.fn(),
    } satisfies WorkerRepository;
    const parsed = {
      email: {
        ...normalizedEmail,
        providerMessageId: event.providerMessageId,
        subject: "Container discharged",
        text: "Automated status: container discharged at destination.",
      },
      raw: Buffer.from("raw"),
      attachmentText: [],
    } satisfies ParsedInboundEmail;
    const emailProvider = {
      listMessages: vi.fn(),
      fetchAndParse: vi.fn().mockResolvedValue(parsed),
      sendReply: vi.fn(),
    } satisfies EmailProvider;
    const classifier: EnquiryClassifier = {
      classify: vi.fn().mockResolvedValue({
        classification: {
          decision: "non_enquiry",
          reason: "This is an automated operational update.",
          evidence: ["Automated status"],
          confidence: 0.99,
        },
        provider: "groq",
        model: "openai/gpt-oss-20b",
        promptVersion: "classifier-v1",
        schemaVersion: "classification-v1",
        usage: { inputTokens: 20, outputTokens: 10 },
      }),
    };
    const extractor = { extract: vi.fn() } satisfies CargoExtractor;
    const runtime = new CargoWorkerRuntime(
      repository,
      () => emailProvider,
      extractor,
      classifier,
      { put: vi.fn().mockResolvedValue("raw-non-enquiry.eml") },
    );

    await expect(runtime.processOneInbound()).resolves.toBe("ignored");
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(repository.persistInbound).not.toHaveBeenCalled();
    expect(repository.persistIgnoredInbound).toHaveBeenCalledWith(
      expect.objectContaining({ event, rawObjectPath: "raw-non-enquiry.eml" }),
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
      listAutomaticInboxes: vi.fn().mockResolvedValue([]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi.fn().mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
      enqueueInbound: vi.fn(),
      claimInbound: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      persistInbound: vi.fn(),
      persistIgnoredInbound: vi.fn(),
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
      quoteClassifier(),
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
      listAutomaticInboxes: vi.fn().mockResolvedValue([]),
      completeAutomaticScan: vi.fn(),
      claimInboxScan: vi.fn().mockResolvedValue(null),
      completeInboxScan: vi.fn(),
      failInboxScan: vi.fn(),
      enqueueInbound: vi.fn(),
      claimInbound: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      persistInbound: vi.fn().mockRejectedValue(failure),
      persistIgnoredInbound: vi.fn(),
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
      quoteClassifier(),
      { put: vi.fn().mockResolvedValue("raw.eml") },
    );

    const summary = await runtime.runOnce();
    expect(summary.inboundFailed).toBe(1);
    expect(repository.persistInbound).toHaveBeenCalledOnce();
    expect(repository.failInbound).toHaveBeenCalledWith(event, failure);
  });
});
