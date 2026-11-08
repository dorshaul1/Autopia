// Words that mark work as security-sensitive or structural. Shared by routing (which methods and checks
// a task gets) and the briefing (which risks are worth telling you about), so both agree.

export const SECURITY_SIGNALS = /\b(auth(?!or)\w*|login|password|passwd|token|jwt|session (token|cookie|id|hijack\w*)|login session|cookie|secret|credential|encrypt\w*|cryptograph\w*|password hash\w*|permission|role-based|rbac|upload|sanitiz\w*|xss|csrf|sql|injection|payment|stripe|webhook|oauth|cors|api key)\b/i
export const ARCH_SIGNALS = /\b(migrat\w*|schema|database|refactor\w*|architecture|restructur\w*|api (change|version)|breaking change|module boundar\w*|data model)\b/i
