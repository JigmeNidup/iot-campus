import path from "node:path";
import crypto from "node:crypto";

export const OTA_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "firmware");

const DEFAULT_OTA_SECRET = "dev-ota-secret-change-me";

function getSecret() {
  return process.env.OTA_TOKEN_SECRET || DEFAULT_OTA_SECRET;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export function sha256Hex(input: Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function createOtaToken(payload: {
  buildId: string;
  deviceId: string;
  expiresAt: number;
}) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOtaToken(token: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  if (expected !== signature) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as {
      buildId: string;
      deviceId: string;
      expiresAt: number;
    };
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
