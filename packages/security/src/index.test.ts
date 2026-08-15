import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./index.js";

describe("secret envelope", () => {
  it("round trips a refresh token without exposing plaintext", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptSecret("refresh-token-value", key);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("refresh-token-value");
    expect(decryptSecret(encrypted, key)).toBe("refresh-token-value");
  });

  it("rejects the wrong key and malformed envelopes", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptSecret("refresh-token-value", key);

    expect(() =>
      decryptSecret(encrypted, randomBytes(32).toString("base64")),
    ).toThrow();
    expect(() => decryptSecret("not-an-envelope", key)).toThrow(
      "Encrypted secret envelope is invalid",
    );
  });
});
