import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      "INBOX_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, keyValue: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(envelope: string, keyValue: string): string {
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
    envelope.split(".");
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedCiphertext ||
    !encodedTag ||
    extra
  ) {
    throw new Error("Encrypted secret envelope is invalid");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyValue),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
