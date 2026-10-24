import { RUN_PATH, parseRun } from "../standard-control/run-contract";
import { parseStatus as parseStandardStatus, STATUS_PATH, COMMAND_PATH } from "../standard-control/contract";
import {
  parseChallenge,
  parseSession as parseWalletSession,
  parseAcknowledgment,
  STATEMENT,
  parseReadiness,
  READINESS_PATH,
} from "../wallet-siws/contract";
import { parseStatus, parseSession as parseControlSession, parseReceipt } from "../solana-live-control";
const CONFIG = Object.freeze({
  origin: "https://btcpredictionlol.lovable.app",
  uri: "https://btcpredictionlol.lovable.app/",
  statement: STATEMENT,
  chainId: "solana:mainnet" as const,
});
/** Reuse strict browser/control contracts before releasing cookie-bearing bodies. */
export function validateSuccess(value: unknown, path: string, status: number, now: number): unknown {
  if (path === RUN_PATH && status === 200) return parseRun(value, now);
  if ((path === STATUS_PATH || path === COMMAND_PATH) && status === 200) {
    const dto = parseStandardStatus(value);
    if (dto.sampled_at_ms > now || now - dto.sampled_at_ms > dto.valid_for_ms || dto.auth_expires_at_ms <= now) throw new Error("Stale backend status");
    if ((path === COMMAND_PATH) !== (dto.command !== null)) throw new Error("Invalid acknowledgment shape");
    return dto;
  }
  if (path.startsWith("/api/wallet-auth/")) {
    if (status !== 200) throw new Error("Invalid success status");
    if (path.endsWith("/challenge")) return parseChallenge(value, CONFIG, now);
    if (path.endsWith("/verify") || path.endsWith("/session")) return parseWalletSession(value, CONFIG, now);
    if (path.endsWith("/cancel")) {
      parseAcknowledgment(value, "canceled", now);
      return value;
    }
    if (path.endsWith("/logout")) {
      parseAcknowledgment(value, "logged_out", now);
      return value;
    }
    throw new Error("Invalid route");
  }
  if (path === READINESS_PATH && status === 200) return parseReadiness(value, now);
  if (path === "/api/control/session" && status === 200) return parseControlSession(value);
  if (path === "/api/control/status" && status === 200) return parseStatus(value);
  if (
    (path === "/api/control/commands" && (status === 200 || status === 202)) ||
    (path.startsWith("/api/control/commands/") && status === 200)
  )
    return parseReceipt(value);
  throw new Error("Invalid success status");
}
