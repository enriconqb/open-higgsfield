import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

/** Same envelope as the session cookie (`iv | tag | ciphertext`, base64url) but
    for arbitrary secrets. API tokens use it to keep a copy of the owner's
    password-derived wrapping key, so a token can unlock the stored platform key
    without the account password. Losing SESSION_SECRET invalidates tokens too. */
function secret(): Buffer {
  const raw = process.env.SESSION_SECRET?.trim();
  if (!raw || raw.length < 16) {
    throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  }
  return createHash("sha256").update(raw).digest();
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function unsealSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < IV_LEN + TAG_LEN + 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
