import type { CargoExtractor } from "@cargo/ai";
import type { EmailProvider } from "@cargo/email";

import type {
  ClaimedInboundEvent,
  ClaimedOutboxDelivery,
  ConnectedInbox,
  RawEmailStore,
  WorkerRepository,
} from "./types.js";

export interface WorkerRunSummary {
  discovered: number;
  inboundProcessed: number;
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

export class CargoWorkerRuntime {
  constructor(
    private readonly repository: WorkerRepository,
    private readonly emailProvider: EmailProviderFactory,
    private readonly extractor: CargoExtractor,
    private readonly rawEmailStore: RawEmailStore,
    private readonly workerId = `worker-${crypto.randomUUID()}`,
  ) {}

  async discoverInbound(): Promise<number> {
    let discovered = 0;
    for (const inbox of await this.repository.listConnectedInboxes()) {
      const provider = this.emailProvider(inbox);
      const messages = await provider.listMessages(250);
      for (const message of messages) {
        if (!message.recipients.includes(inbox.address.toLowerCase())) continue;
        const inserted = await this.repository.enqueueInbound(
          inbox,
          message.providerMessageId,
          {
            rfcMessageId: message.rfcMessageId,
            createdAt: message.createdAt.toISOString(),
          },
        );
        if (inserted) discovered += 1;
      }
    }
    return discovered;
  }

  async processOneInbound(): Promise<boolean> {
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
      const extraction = await this.extractor.extract({
        subject: parsed.email.subject,
        sender: parsed.email.from.address,
        receivedAt: parsed.email.receivedAt,
        latestMessage: parsed.email.text,
        attachmentText: parsed.attachmentText,
      });
      await this.repository.persistInbound({
        event,
        parsed,
        extraction,
        rawObjectPath,
      });
      return true;
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
    const summary: WorkerRunSummary = {
      discovered: await this.discoverInbound(),
      inboundProcessed: 0,
      inboundFailed: 0,
      repliesSent: 0,
      repliesFailed: 0,
    };

    for (let index = 0; index < maxJobs; index += 1) {
      try {
        if (!(await this.processOneInbound())) break;
        summary.inboundProcessed += 1;
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
