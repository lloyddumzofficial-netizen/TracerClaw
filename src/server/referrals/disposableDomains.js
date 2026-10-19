// Versioned, deliberately local deny-list. Keep this list reviewed in source
// control; referral settlement rechecks it so newly blocked domains do not pay.
export const DISPOSABLE_DOMAIN_LIST_VERSION = "2026-10-20.1";

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "disposablemail.com",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "goldlical.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "maildrop.cc",
  "mail.gw",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "sharklasers.com",
  "temp-mail.org",
  "tempail.com",
  "tempemail.com",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "inboxkitten.com",
  "yopmail.com",
]);

export function normalizeEmailDomain(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return "";
  return normalized.slice(at + 1).replace(/\.+$/, "");
}

export function isDisposableEmailDomain(domainOrEmail) {
  const input = String(domainOrEmail || "").trim().toLowerCase();
  const domain = input.includes("@") ? normalizeEmailDomain(input) : input.replace(/\.+$/, "");
  if (!domain) return true;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  return [...DISPOSABLE_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`));
}
