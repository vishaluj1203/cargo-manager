import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";

import {
  MailpitEmailProvider,
  parseInboundMime,
  replyReferences,
  replySubject,
} from "./index.js";

const raw = Buffer.from(`From: Maya Chen <maya@northstar.example>
To: Cargo Desk <cargo@skyvalence.local>
Subject: Urgent status needed for TCLU1234567
Date: Sun, 16 Aug 2026 10:30:00 +0530
Message-ID: <customer-123@northstar.example>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Hello team,

Please confirm the current location of container TCLU1234567 from Singapore to Rotterdam.
We need delivery by Friday, 21 August. Is it still on schedule?

Thanks,
Maya
`);

describe("email adapter", () => {
  it("parses RFC MIME structure without cargo-field regex extraction", async () => {
    const parsed = await parseInboundMime(raw, "mailpit-1");
    expect(parsed.email).toMatchObject({
      provider: "local_mailpit",
      providerMessageId: "mailpit-1",
      messageId: "<customer-123@northstar.example>",
      from: { name: "Maya Chen", address: "maya@northstar.example" },
      subject: "Urgent status needed for TCLU1234567",
    });
    expect(parsed.email.text).toContain("Singapore to Rotterdam");
  });

  it("lists Mailpit messages and filters no business fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              ID: "mailpit-1",
              MessageID: "customer-123@northstar.example",
              Created: "2026-08-16T05:00:00Z",
              To: [{ Name: "Cargo", Address: "cargo@skyvalence.local" }],
              Cc: null,
              Bcc: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MailpitEmailProvider({
      fetcher,
      transporter: nodemailer.createTransport({ jsonTransport: true }),
    });
    await expect(provider.listMessages()).resolves.toEqual([
      {
        providerMessageId: "mailpit-1",
        rfcMessageId: "customer-123@northstar.example",
        createdAt: new Date("2026-08-16T05:00:00Z"),
        recipients: ["cargo@skyvalence.local"],
      },
    ]);
  });

  it("constructs standards-based reply threading", () => {
    expect(replySubject("Delay alert")).toBe("Re: Delay alert");
    expect(replySubject("RE: Delay alert")).toBe("RE: Delay alert");
    expect(
      replyReferences(["<root@example.com>"], "parent@example.com"),
    ).toEqual(["<root@example.com>", "<parent@example.com>"]);
  });
});
