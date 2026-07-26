const REDACTION_PATTERNS = [
  { pattern: /https?:\/\/[^\s"')]+/gi, replacement: "[redacted-url]" },
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: "[redacted-email]" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "Bearer [redacted-token]" },
];

function debugEnabled() {
  return process.env.LOG_LEVEL === "debug" || process.env.NEXT_PUBLIC_LOG_LEVEL === "debug";
}

function redactString(value) {
  return REDACTION_PATTERNS.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), value);
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: debugEnabled() ? redactString(value.stack || "") : undefined,
    };
  }
  if (depth > 4) return "[redacted-depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|key|signature|authorization|password/i.test(key)
          ? "[redacted]"
          : redact(item, depth + 1),
      ])
    );
  }
  return value;
}

function write(level, args) {
  const writer = console[level] || console.log;
  writer("[DesaynClaw]", ...args.map((arg) => redact(arg)));
}

export const logger = {
  debug: (...args) => {
    if (debugEnabled()) write("debug", args);
  },
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
};
