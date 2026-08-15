import type { ExtractionResult } from "@cargo/ai";
import type {
  ParsedInboundEmail,
  SendReplyInput,
  SentEmail,
} from "@cargo/email";

export interface ConnectedInbox {
  id: string;
  organizationId: string;
  provider: "local_mailpit" | "gmail" | "microsoft";
  address: string;
  encryptedRefreshToken: string | null;
  grantedScopes: string[];
}

export interface ClaimedInboundEvent {
  id: string;
  organizationId: string;
  inboxConnectionId: string;
  provider: ConnectedInbox["provider"];
  address: string;
  encryptedRefreshToken: string | null;
  grantedScopes: string[];
  providerMessageId: string;
  attempts: number;
}

export interface PersistInboundInput {
  event: ClaimedInboundEvent;
  parsed: ParsedInboundEmail;
  extraction: ExtractionResult;
  rawObjectPath: string | null;
}

export interface PersistInboundResult {
  ticketId: string;
  ticketNumber: string;
  duplicate: boolean;
}

export interface ClaimedOutboxDelivery {
  jobId: string;
  organizationId: string;
  ticketId: string;
  emailId: string;
  attempts: number;
  inboxConnectionId: string;
  provider: ConnectedInbox["provider"];
  address: string;
  encryptedRefreshToken: string | null;
  grantedScopes: string[];
  message: SendReplyInput;
}

export interface WorkerRepository {
  listConnectedInboxes(): Promise<ConnectedInbox[]>;
  enqueueInbound(
    inbox: ConnectedInbox,
    providerMessageId: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean>;
  claimInbound(workerId: string): Promise<ClaimedInboundEvent | null>;
  persistInbound(input: PersistInboundInput): Promise<PersistInboundResult>;
  failInbound(event: ClaimedInboundEvent, error: Error): Promise<void>;
  claimOutbox(workerId: string): Promise<ClaimedOutboxDelivery | null>;
  markOutboxSent(
    delivery: ClaimedOutboxDelivery,
    sent: SentEmail,
  ): Promise<void>;
  failOutbox(delivery: ClaimedOutboxDelivery, error: Error): Promise<void>;
  close(): Promise<void>;
}

export interface RawEmailStore {
  put(
    organizationId: string,
    provider: ConnectedInbox["provider"],
    providerMessageId: string,
    raw: Buffer,
  ): Promise<string>;
}
