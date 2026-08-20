import type { EnquiryClassificationResult, ExtractionResult } from "@cargo/ai";
import type { EnquiryDetectionPolicy } from "@cargo/contracts";
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
  enquiryPolicy?: EnquiryDetectionPolicy;
}

export interface AutomaticInbox extends ConnectedInbox {
  lastSyncedAt: Date | string;
}

export interface ClaimedInboxScan extends ConnectedInbox {
  scanId: string;
  scope: "recent_demo" | "all_demo";
  query: string;
  attempts: number;
}

export interface ClaimedInboundEvent {
  id: string;
  organizationId: string;
  inboxConnectionId: string;
  provider: ConnectedInbox["provider"];
  address: string;
  encryptedRefreshToken: string | null;
  grantedScopes: string[];
  enquiryPolicy?: EnquiryDetectionPolicy;
  providerMessageId: string;
  attempts: number;
}

export interface PersistInboundInput {
  event: ClaimedInboundEvent;
  parsed: ParsedInboundEmail;
  classification: EnquiryClassificationResult;
  extraction: ExtractionResult;
  rawObjectPath: string | null;
  forceReview: boolean;
}

export interface PersistIgnoredInboundInput {
  event: ClaimedInboundEvent;
  classification: EnquiryClassificationResult;
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
  listAutomaticInboxes(): Promise<AutomaticInbox[]>;
  completeAutomaticScan(inbox: AutomaticInbox, scannedAt: Date): Promise<void>;
  claimInboxScan(workerId: string): Promise<ClaimedInboxScan | null>;
  completeInboxScan(scan: ClaimedInboxScan, discovered: number): Promise<void>;
  failInboxScan(scan: ClaimedInboxScan, error: Error): Promise<void>;
  enqueueInbound(
    inbox: ConnectedInbox,
    providerMessageId: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean>;
  claimInbound(workerId: string): Promise<ClaimedInboundEvent | null>;
  persistInbound(input: PersistInboundInput): Promise<PersistInboundResult>;
  persistIgnoredInbound(input: PersistIgnoredInboundInput): Promise<void>;
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
