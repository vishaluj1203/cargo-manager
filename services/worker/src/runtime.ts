import type { CargoExtractor, EnquiryClassifier } from "@cargo/ai";
import {
  defaultEnquiryDetectionPolicy,
  enquiryDetectionPolicySchema,
  type EnquiryClassification,
  type EnquiryDetectionPolicy,
} from "@cargo/contracts";
import type { EmailProvider } from "@cargo/email";

import type {
  ClaimedInboundEvent,
  ClaimedOutboxDelivery,
  ConnectedInbox,
  RawEmailStore,
  WorkerRepository,
} from "./types.js";

export interface WorkerRunSummary {
  automaticInboxesScanned: number;
  automaticScanFailures: number;
  scansProcessed: number;
  scansFailed: number;
  discovered: number;
  inboundProcessed: number;
  inboundIgnored: number;
  inboundFailed: number;
  repliesSent: number;
  repliesFailed: number;
}

export type EmailProviderFactory = (
  connection: Pick<
    ConnectedInbox,
    "provider" | "address" | "encryptedRefreshToken" | "grantedScopes"
  >,
) => EmailProvider;

export type EnquiryRoute = "ticket" | "review" | "ignore";

export function routeEnquiryClassification(
  classification: EnquiryClassification,
  policy: EnquiryDetectionPolicy,
): EnquiryRoute {
  if (classification.decision === "non_enquiry") return "ignore";
  if (
    classification.decision === "existing_quote_follow_up" &&
    !policy.acceptExistingQuoteFollowUps
  ) {
    return "ignore";
  }
  if (
    classification.decision === "uncertain" ||
    classification.confidence < policy.minimumConfidence
  ) {
    return policy.uncertainAction;
  }
  return "ticket";
}

function resolveEnquiryPolicy(
  value: EnquiryDetectionPolicy | undefined,
): EnquiryDetectionPolicy {
  const parsed = enquiryDetectionPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultEnquiryDetectionPolicy;
}

export class CargoWorkerRuntime {
  constructor(
    private readonly repository: WorkerRepository,
    private readonly emailProvider: EmailProviderFactory,
    private readonly extractor: CargoExtractor,
    private readonly classifier: EnquiryClassifier,
    private readonly rawEmailStore: RawEmailStore,
    private readonly workerId = `worker-${crypto.randomUUID()}`,
    private readonly automaticQuery = process.env.GMAIL_INITIAL_QUERY ??
      'newer_than:7d subject:"[Cargo Demo]"',
  ) {}

  async discoverNewInbound(): Promise<{
    automaticInboxesScanned: number;
    automaticScanFailures: number;
    discovered: number;
  }> {
    let automaticInboxesScanned = 0;
    let automaticScanFailures = 0;
    let discovered = 0;
    for (const inbox of await this.repository.listAutomaticInboxes()) {
      const scannedAt = new Date();
      const lastSyncedAt = new Date(inbox.lastSyncedAt);
      if (Number.isNaN(lastSyncedAt.getTime())) {
        automaticScanFailures += 1;
        continue;
      }
      const overlapStart = new Date(lastSyncedAt.getTime() - 5 * 60 * 1_000);
      const query =
        `after:${Math.floor(overlapStart.getTime() / 1_000)} ${this.automaticQuery}`.trim();
      try {
        const messages = await this.emailProvider(inbox).listMessages(500, {
          query,
        });
        for (const message of messages) {
          if (!message.recipients.includes(inbox.address.toLowerCase()))
            continue;
          const inserted = await this.repository.enqueueInbound(
            inbox,
            message.providerMessageId,
            {
              rfcMessageId: message.rfcMessageId,
              createdAt: message.createdAt.toISOString(),
              discovery: "automatic_new_mail",
            },
          );
          if (inserted) discovered += 1;
        }
        await this.repository.completeAutomaticScan(inbox, scannedAt);
        automaticInboxesScanned += 1;
      } catch {
        automaticScanFailures += 1;
      }
    }
    return { automaticInboxesScanned, automaticScanFailures, discovered };
  }

  async processRequestedScans(maxScans = 5): Promise<{
    scansProcessed: number;
    scansFailed: number;
    discovered: number;
  }> {
    let scansProcessed = 0;
    let scansFailed = 0;
    let discovered = 0;
    for (let index = 0; index < maxScans; index += 1) {
      const scan = await this.repository.claimInboxScan(this.workerId);
      if (!scan) break;
      try {
        let scanDiscovered = 0;
        const provider = this.emailProvider(scan);
        const messages = await provider.listMessages(500, {
          query: scan.query,
        });
        for (const message of messages) {
          if (!message.recipients.includes(scan.address.toLowerCase()))
            continue;
          const inserted = await this.repository.enqueueInbound(
            scan,
            message.providerMessageId,
            {
              rfcMessageId: message.rfcMessageId,
              createdAt: message.createdAt.toISOString(),
              scanRequestId: scan.scanId,
            },
          );
          if (inserted) {
            scanDiscovered += 1;
            discovered += 1;
          }
        }
        await this.repository.completeInboxScan(scan, scanDiscovered);
        scansProcessed += 1;
      } catch (cause) {
        await this.repository.failInboxScan(scan, toError(cause));
        scansFailed += 1;
      }
    }
    return { scansProcessed, scansFailed, discovered };
  }

  async processOneInbound(): Promise<"ticketed" | "ignored" | false> {
    const event = await this.repository.claimInbound(this.workerId);
    if (!event) return false;

    try {
      const parsed = await this.emailProvider(event).fetchAndParse(
        event.providerMessageId,
      );
      const rawObjectPath = await this.rawEmailStore.put(
        event.organizationId,
        event.provider,
        event.providerMessageId,
        parsed.raw,
      );
      const aiInput = {
        subject: parsed.email.subject,
        sender: parsed.email.from.address,
        receivedAt: parsed.email.receivedAt,
        latestMessage: parsed.email.text,
        attachmentText: parsed.attachmentText,
      };
      const classification = await this.classifier.classify(aiInput);
      const route = routeEnquiryClassification(
        classification.classification,
        resolveEnquiryPolicy(event.enquiryPolicy),
      );
      if (route === "ignore") {
        await this.repository.persistIgnoredInbound({
          event,
          classification,
          rawObjectPath,
        });
        return "ignored";
      }
      const extraction = await this.extractor.extract(aiInput);
      await this.repository.persistInbound({
        event,
        parsed,
        classification,
        extraction,
        rawObjectPath,
        forceReview: route === "review",
      });
      return "ticketed";
    } catch (cause) {
      await this.repository.failInbound(event, toError(cause));
      throw cause;
    }
  }

  async deliverOneReply(): Promise<boolean> {
    const delivery = await this.repository.claimOutbox(this.workerId);
    if (!delivery) return false;
    try {
      const sent = await this.emailProvider(delivery).sendReply(
        delivery.message,
      );
      await this.repository.markOutboxSent(delivery, sent);
      return true;
    } catch (cause) {
      await this.repository.failOutbox(delivery, toError(cause));
      throw cause;
    }
  }

  async runOnce(maxJobs = 50): Promise<WorkerRunSummary> {
    const automatic = await this.discoverNewInbound();
    const scans = await this.processRequestedScans();
    const summary: WorkerRunSummary = {
      automaticInboxesScanned: automatic.automaticInboxesScanned,
      automaticScanFailures: automatic.automaticScanFailures,
      ...scans,
      discovered: automatic.discovered + scans.discovered,
      inboundProcessed: 0,
      inboundIgnored: 0,
      inboundFailed: 0,
      repliesSent: 0,
      repliesFailed: 0,
    };

    for (let index = 0; index < maxJobs; index += 1) {
      try {
        const outcome = await this.processOneInbound();
        if (!outcome) break;
        summary.inboundProcessed += 1;
        if (outcome === "ignored") summary.inboundIgnored += 1;
      } catch {
        summary.inboundFailed += 1;
      }
    }
    for (let index = 0; index < maxJobs; index += 1) {
      try {
        if (!(await this.deliverOneReply())) break;
        summary.repliesSent += 1;
      } catch {
        summary.repliesFailed += 1;
      }
    }
    return summary;
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export function safeErrorMessage(error: Error): string {
  return error.message.slice(0, 2_000);
}

export type { ClaimedInboundEvent, ClaimedOutboxDelivery };
