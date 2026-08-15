import { normalizedEmailSchema, type NormalizedEmail } from "@cargo/contracts";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

export interface MailboxMessageSummary {
  providerMessageId: string;
  rfcMessageId: string | null;
  createdAt: Date;
  recipients: string[];
}

export interface ParsedInboundEmail {
  email: NormalizedEmail;
  raw: Buffer;
  attachmentText: Array<{ name: string; text: string }>;
}

export interface SendReplyInput {
  from: string;
  to: string;
  cc?: string[];
  subject: string;
  bodyText: string;
  messageId?: string;
  inReplyTo: string;
  references: string[];
}

export interface SentEmail {
  providerMessageId: string;
  messageId: string;
  sentAt: Date;
}

export interface EmailProvider {
  listMessages(limit?: number): Promise<MailboxMessageSummary[]>;
  fetchAndParse(providerMessageId: string): Promise<ParsedInboundEmail>;
  sendReply(input: SendReplyInput): Promise<SentEmail>;
}

const addressSchema = z.object({
  Name: z.string().default(""),
  Address: z.string(),
});
const addressListSchema = z
  .array(addressSchema)
  .nullish()
  .transform((value) => value ?? []);

const mailpitListSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      MessageID: z.string().nullish(),
      Created: z.string(),
      To: addressListSchema,
      Cc: addressListSchema,
      Bcc: addressListSchema,
    }),
  ),
});

function normalizeMessageId(
  value: string | undefined,
  fallback: string,
): string {
  const candidate = value?.trim();
  if (!candidate) return `<${fallback}@mailpit.local>`;
  return candidate.startsWith("<") ? candidate : `<${candidate}>`;
}

function addressValues(
  address: AddressObject | AddressObject[] | undefined,
): AddressObject["value"] {
  if (!address) return [];
  const objects = Array.isArray(address) ? address : [address];
  return objects.flatMap((item) => item.value);
}

function firstFrom(parsed: ParsedMail): {
  name: string | null;
  address: string;
} {
  const first = addressValues(parsed.from)[0];
  if (!first?.address)
    throw new Error("Inbound email has no valid From address");
  return { name: first.name || null, address: first.address.toLowerCase() };
}

function recipients(address: AddressObject | AddressObject[] | undefined) {
  return addressValues(address)
    .filter((item): item is typeof item & { address: string } =>
      Boolean(item.address),
    )
    .map((item) => ({
      name: item.name || null,
      address: item.address.toLowerCase(),
    }));
}

function references(parsed: ParsedMail): string[] {
  const value = parsed.references;
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((item) =>
    normalizeMessageId(item, "unknown"),
  );
}

export async function parseInboundMime(
  raw: Buffer,
  providerMessageId: string,
): Promise<ParsedInboundEmail> {
  const parsed = await simpleParser(raw, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    maxHtmlLengthToParse: 2_000_000,
  });
  const rfcMessageId = normalizeMessageId(parsed.messageId, providerMessageId);
  const text = parsed.text?.trim() || "[No readable text body]";
  const subject = parsed.subject?.trim() || "(no subject)";

  const email = normalizedEmailSchema.parse({
    provider: "local_mailpit",
    providerMessageId,
    providerThreadId: null,
    messageId: rfcMessageId,
    inReplyTo: parsed.inReplyTo
      ? normalizeMessageId(parsed.inReplyTo, "unknown")
      : null,
    references: references(parsed),
    from: firstFrom(parsed),
    to: recipients(parsed.to),
    cc: recipients(parsed.cc),
    subject,
    text,
    html: typeof parsed.html === "string" ? parsed.html : null,
    receivedAt: parsed.date ?? new Date(),
    rawObjectKey: null,
  });

  const attachmentText = parsed.attachments
    .filter((attachment) => attachment.contentType.startsWith("text/"))
    .map((attachment) => ({
      name: attachment.filename || "unnamed-text-attachment",
      text: attachment.content.toString("utf8").slice(0, 100_000),
    }));

  return { email, raw, attachmentText };
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export function replyReferences(
  existing: string[],
  parentMessageId: string,
): string[] {
  return Array.from(
    new Set(
      [...existing, parentMessageId].map((item) =>
        normalizeMessageId(item, "unknown"),
      ),
    ),
  );
}

export interface MailpitProviderOptions {
  apiUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  fetcher?: typeof fetch;
  transporter?: Transporter;
}

export class MailpitEmailProvider implements EmailProvider {
  readonly #apiUrl: string;
  readonly #fetcher: typeof fetch;
  readonly #transporter: Transporter;

  constructor(options: MailpitProviderOptions = {}) {
    this.#apiUrl = (options.apiUrl ?? "http://127.0.0.1:8025").replace(
      /\/$/,
      "",
    );
    this.#fetcher = options.fetcher ?? fetch;
    this.#transporter =
      options.transporter ??
      nodemailer.createTransport({
        host: options.smtpHost ?? "127.0.0.1",
        port: options.smtpPort ?? 1025,
        secure: false,
        ignoreTLS: true,
      });
  }

  async listMessages(limit = 100): Promise<MailboxMessageSummary[]> {
    const response = await this.#fetcher(
      `${this.#apiUrl}/api/v1/messages?start=0&limit=${limit}`,
    );
    if (!response.ok)
      throw new Error(`Mailpit list failed (${response.status})`);
    const payload = mailpitListSchema.parse(await response.json());
    return payload.messages.map((message) => ({
      providerMessageId: message.ID,
      rfcMessageId: message.MessageID ?? null,
      createdAt: new Date(message.Created),
      recipients: [...message.To, ...message.Cc, ...message.Bcc].map((entry) =>
        entry.Address.toLowerCase(),
      ),
    }));
  }

  async fetchAndParse(providerMessageId: string): Promise<ParsedInboundEmail> {
    const response = await this.#fetcher(
      `${this.#apiUrl}/api/v1/message/${encodeURIComponent(providerMessageId)}/raw`,
    );
    if (!response.ok)
      throw new Error(`Mailpit raw message fetch failed (${response.status})`);
    return parseInboundMime(
      Buffer.from(await response.arrayBuffer()),
      providerMessageId,
    );
  }

  async sendReply(input: SendReplyInput): Promise<SentEmail> {
    const result = await this.#transporter.sendMail({
      from: input.from,
      to: input.to,
      cc: input.cc,
      subject: replySubject(input.subject),
      text: input.bodyText,
      messageId: input.messageId,
      inReplyTo: normalizeMessageId(input.inReplyTo, "unknown"),
      references: replyReferences(input.references, input.inReplyTo),
    });
    const messageId = normalizeMessageId(
      result.messageId,
      `outbound-${Date.now()}`,
    );
    return {
      providerMessageId: messageId,
      messageId,
      sentAt: new Date(),
    };
  }
}

export function createEmailProviderFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): MailpitEmailProvider {
  return new MailpitEmailProvider({
    apiUrl: environment.LOCAL_MAIL_API_URL,
    smtpHost: environment.LOCAL_MAIL_SMTP_HOST,
    smtpPort: environment.LOCAL_MAIL_SMTP_PORT
      ? Number(environment.LOCAL_MAIL_SMTP_PORT)
      : undefined,
  });
}
