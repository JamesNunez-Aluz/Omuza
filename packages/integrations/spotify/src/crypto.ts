import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-layer envelope encryption for OAuth secrets (spec §16.4, ADR 0012):
 * AES-256-GCM, per-record nonce, key versioning for rotation. Lives in the
 * destination package so only the destination code path can decrypt.
 * Plaintext tokens must never leave this process boundary — not into logs,
 * API responses, analytics, or the client.
 */

export interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
}

export class TokenCipher {
  private readonly key: Buffer;

  constructor(
    keyB64: string,
    private readonly keyVersion: string,
  ) {
    if (!keyB64) {
      throw new Error("TOKEN_ENCRYPTION_KEY_B64 is required for the Spotify export pilot");
    }
    this.key = Buffer.from(keyB64, "base64");
    if (this.key.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes");
    }
  }

  encrypt(plaintext: string): EncryptedSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  decrypt(secret: EncryptedSecret): string {
    if (secret.keyVersion !== this.keyVersion) {
      throw new Error(
        `credential key version ${secret.keyVersion} does not match active ${this.keyVersion}; run key rotation`,
      );
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, secret.nonce);
    decipher.setAuthTag(secret.authTag);
    return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString("utf8");
  }
}
