// Memory never reads secret files and never stores secret-looking values, whoever wrote the text.

const SECRET_PATH =
  /(^|\/)(\.env(\..*)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_rsa[^/]*|id_ed25519[^/]*|credentials[^/]*|secrets?\.(json|ya?ml|toml)|service-account[^/]*\.json)$|\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i

export function isSecretPath(path: string): boolean {
  return SECRET_PATH.test(path)
}

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b[sprk]{1,2}k?_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g // JWT
]

/** KEY=value / "key": "value" where the key names a secret. */
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:secret|token|passwd|password|api[_-]?key|private[_-]?key|access[_-]?key|auth(?!or))[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)([^\s"'`,;]{6,})/gi

/** Replaces anything that looks like a credential with [redacted]. */
export function redact(text: string): string {
  let out = text
  for (const p of TOKEN_PATTERNS) out = out.replace(p, '[redacted]')
  // a password inside an address: postgres://me:hunter2@db
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[redacted]@')
  return out.replace(ASSIGNMENT, (_m, key, sep) => `${key}${sep}[redacted]`)
}
