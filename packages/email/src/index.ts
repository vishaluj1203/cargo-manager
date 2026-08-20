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
  providerThreadId?: string | null;
}

export interface SentEmail {
  providerMessageId: string;
  messageId: string;
  sentAt: Date;
}

export interface MailboxListOptions {
  query?: string;
}

export interface EmailProvider {
  listMessages(
    limit?: number,
    options?: MailboxListOptions,
  ): Promise<MailboxMessageSummary[]>;
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
  provider: NormalizedEmail["provider"] = "local_mailpit",
  providerThreadId: string | null = null,
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
    provider,
    providerMessageId,
    providerThreadId,
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

  async listMessages(
    limit = 100,
    _options: MailboxListOptions = {},
  ): Promise<MailboxMessageSummary[]> {
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

const googleTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().optional(),
});

const gmailMessageListSchema = z.object({
  messages: z
    .array(z.object({ id: z.string(), threadId: z.string() }))
    .optional(),
});

const gmailRawMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  internalDate: z.string().optional(),
  raw: z.string(),
});

const gmailSentMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

export interface GmailProviderOptions {
  address: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  query?: string;
  fetcher?: typeof fetch;
}

function gmailApiError(operation: string, response: Response, detail: string) {
  return new Error(
    `Gmail API ${operation} failed (${response.status}): ${detail.slice(0, 500)}`,
  );
}

export class GmailEmailProvider implements EmailProvider {
  readonly #address: string;
  readonly #refreshToken: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #query: string;
  readonly #fetcher: typeof fetch;
  #accessToken: { value: string; expiresAt: number } | null = null;

  constructor(options: GmailProviderOptions) {
    for (const [name, value] of Object.entries({
      address: options.address,
      refreshToken: options.refreshToken,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    })) {
      if (!value.trim()) throw new Error(`Gmail ${name} is required`);
    }
    this.#address = options.address.toLowerCase();
    this.#refreshToken = options.refreshToken;
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#query = options.query ?? "newer_than:7d";
    this.#fetcher = options.fetcher ?? fetch;
  }

  async #token(): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now()) {
      return this.#accessToken.value;
    }
    const response = await this.#fetcher(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          refresh_token: this.#refreshToken,
          grant_type: "refresh_token",
        }),
      },
    );
    if (!response.ok) {
      throw gmailApiError("token refresh", response, await response.text());
    }
    const token = googleTokenSchema.parse(await response.json());
    this.#accessToken = {
      value: token.access_token,
      expiresAt: Date.now() + Math.max(token.expires_in - 60, 1) * 1_000,
    };
    return token.access_token;
  }

  async #request(path: string, init?: RequestInit): Promise<Response> {
    const accessToken = await this.#token();
    return this.#fetcher(`https://gmail.googleapis.com/gmail/v1${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
    });
  }

  async listMessages(
    limit = 100,
    options: MailboxListOptions = {},
  ): Promise<MailboxMessageSummary[]> {
    const query = new URLSearchParams({
      maxResults: String(Math.min(Math.max(limit, 1), 500)),
      labelIds: "INBOX",
      q: options.query?.trim() || this.#query,
    });
    const response = await this.#request(
      `/users/me/messages?${query.toString()}`,
    );
    if (!response.ok) {
      throw gmailApiError("message list", response, await response.text());
    }
    const payload = gmailMessageListSchema.parse(await response.json());
    return (payload.messages ?? []).map((message) => ({
      providerMessageId: message.id,
      rfcMessageId: null,
      createdAt: new Date(),
      recipients: [this.#address],
    }));
  }

  async fetchAndParse(providerMessageId: string): Promise<ParsedInboundEmail> {
    const response = await this.#request(
      `/users/me/messages/${encodeURIComponent(providerMessageId)}?format=raw`,
    );
    if (!response.ok) {
      throw gmailApiError("message fetch", response, await response.text());
    }
    const payload = gmailRawMessageSchema.parse(await response.json());
    return parseInboundMime(
      Buffer.from(payload.raw, "base64url"),
      payload.id,
      "gmail",
      payload.threadId,
    );
  }

  async sendReply(input: SendReplyInput): Promise<SentEmail> {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    const rendered = await transport.sendMail({
      from: input.from || this.#address,
      to: input.to,
      cc: input.cc,
      subject: replySubject(input.subject),
      text: input.bodyText,
      messageId: input.messageId,
      inReplyTo: normalizeMessageId(input.inReplyTo, "unknown"),
      references: replyReferences(input.references, input.inReplyTo),
    });
    const message = rendered.message;
    const raw = Buffer.isBuffer(message)
      ? message
      : Buffer.from(String(message), "utf8");
    const response = await this.#request("/users/me/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: raw.toString("base64url"),
        ...(input.providerThreadId ? { threadId: input.providerThreadId } : {}),
      }),
    });
    if (!response.ok) {
      throw gmailApiError("message send", response, await response.text());
    }
    const sent = gmailSentMessageSchema.parse(await response.json());
    return {
      providerMessageId: sent.id,
      messageId: normalizeMessageId(
        input.messageId,
        `gmail-${sent.id}@mail.gmail.com`,
      ),
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
