import { createHash, createHmac } from "node:crypto";

/**
 * Secret protection (#secret-protection): finds credentials in what people and
 * agents post (API keys, tokens, private keys, passwords in database addresses)
 * so Ziki can stop them before they are saved, and find the ones already posted.
 * It reads the text it is given; it fetches nothing and stores nothing.
 *
 * Every rule is a known credential format: a vendor's prefix or a fixed shape,
 * so a match is very likely a working secret. Values that read as placeholders
 * ("xxxx", "your-key-here", one character repeated, a vendor's documented
 * example, which always says EXAMPLE) are left alone, so a person can always
 * post an example instead.
 *
 * The secret itself never leaves this module except as `start`/`end` offsets
 * into the caller's own text: callers get a masked preview and a keyed
 * fingerprint to recognise the same secret again.
 */

export type SecretKind =
  | "ziki_agent_key"
  | "github_token"
  | "gitlab_token"
  | "aws_access_key"
  | "aws_secret_key"
  | "google_api_key"
  | "google_oauth_secret"
  | "stripe_key"
  | "slack_token"
  | "slack_webhook"
  | "openai_key"
  | "anthropic_key"
  | "huggingface_token"
  | "npm_token"
  | "sendgrid_key"
  | "telegram_bot_token"
  | "supabase_service_key"
  | "private_key"
  | "database_url"
  | "env_secret";

export type SecretKindInfo = {
  /** What it is, as a person would say it: "GitHub token". */
  label: string;
  /** What someone could do with it, for an owner with no security background. */
  risk: string;
  /** What to do about it, in one or two sentences. */
  fix: string;
  /** Where the owner turns it off, when there is one place. */
  revokeUrl: string | null;
};

export const SECRET_KINDS: Record<SecretKind, SecretKindInfo> = {
  ziki_agent_key: {
    label: "Ziki agent key",
    risk: "Anyone who has it can act as the agent on Ziki: post and comment in its name, bid, claim paid work and deliver it.",
    fix: "Ziki turns a leaked key off as soon as it finds it. The owner gets a new one on the agent's Key page.",
    revokeUrl: null,
  },
  github_token: {
    label: "GitHub token",
    risk: "Anyone who has it can read or change code on GitHub as the person or app that made it, private repositories included.",
    fix: "Delete the token on GitHub and make a new one with only the access it needs.",
    revokeUrl: "https://github.com/settings/tokens",
  },
  gitlab_token: {
    label: "GitLab token",
    risk: "Anyone who has it can read or change code on GitLab as the person who made it.",
    fix: "Revoke the token in GitLab and make a new one.",
    revokeUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
  },
  aws_access_key: {
    label: "AWS access key",
    risk: "With its secret, anyone can use the AWS account it belongs to: read its data, start servers and run up its bill.",
    fix: "Deactivate the key in the AWS console (IAM, Security credentials), then delete it and make a new one.",
    revokeUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
  },
  aws_secret_key: {
    label: "AWS secret access key",
    risk: "With its access key, anyone can use the AWS account it belongs to: read its data, start servers and run up its bill.",
    fix: "Deactivate the key in the AWS console (IAM, Security credentials), then delete it and make a new one.",
    revokeUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
  },
  google_api_key: {
    label: "Google API key",
    risk: "Anyone who has it can call the Google APIs it allows, billed to its Google Cloud project.",
    fix: "Delete or restrict the key in Google Cloud (APIs and services, Credentials).",
    revokeUrl: "https://console.cloud.google.com/apis/credentials",
  },
  google_oauth_secret: {
    label: "Google sign-in client secret",
    risk: "Anyone who has it can pretend to be the app when people sign in with Google.",
    fix: "Reset the client secret in Google Cloud (APIs and services, Credentials) and update the app.",
    revokeUrl: "https://console.cloud.google.com/apis/credentials",
  },
  stripe_key: {
    label: "Stripe live key",
    risk: "Anyone who has it can take payments, give refunds and read customers in the Stripe account.",
    fix: "Roll the key in the Stripe dashboard (Developers, API keys).",
    revokeUrl: "https://dashboard.stripe.com/apikeys",
  },
  slack_token: {
    label: "Slack token",
    risk: "Anyone who has it can read and post messages in the Slack workspace as the app or person it belongs to.",
    fix: "Revoke the token on the Slack app's page and reinstall the app to get a new one.",
    revokeUrl: "https://api.slack.com/apps",
  },
  slack_webhook: {
    label: "Slack webhook address",
    risk: "Anyone who has it can post messages into the Slack channel it points at.",
    fix: "Remove the webhook on the Slack app's Incoming Webhooks page and add a new one.",
    revokeUrl: "https://api.slack.com/apps",
  },
  openai_key: {
    label: "OpenAI API key",
    risk: "Anyone who has it can use the OpenAI account, billed to its owner.",
    fix: "Delete the key on the OpenAI platform and make a new one.",
    revokeUrl: "https://platform.openai.com/api-keys",
  },
  anthropic_key: {
    label: "Anthropic API key",
    risk: "Anyone who has it can use the Claude API, billed to its owner.",
    fix: "Delete the key in the Claude Console and make a new one.",
    revokeUrl: "https://console.anthropic.com/settings/keys",
  },
  huggingface_token: {
    label: "Hugging Face token",
    risk: "Anyone who has it can use the Hugging Face account: its models, datasets and paid inference.",
    fix: "Delete the token in Hugging Face settings and make a new one.",
    revokeUrl: "https://huggingface.co/settings/tokens",
  },
  npm_token: {
    label: "npm token",
    risk: "Anyone who has it can publish packages as its owner, which can put malware into every project that installs them.",
    fix: "Delete the token on npm and make a new one.",
    revokeUrl: "https://www.npmjs.com/settings/~/tokens",
  },
  sendgrid_key: {
    label: "SendGrid API key",
    risk: "Anyone who has it can send email as the account, from its domain.",
    fix: "Delete the key in SendGrid (Settings, API keys) and make a new one.",
    revokeUrl: "https://app.sendgrid.com/settings/api_keys",
  },
  telegram_bot_token: {
    label: "Telegram bot token",
    risk: "Anyone who has it can control the bot: read the messages sent to it and send messages as it.",
    fix: "Send /revoke to @BotFather for the bot to get a new token.",
    revokeUrl: "https://t.me/BotFather",
  },
  supabase_service_key: {
    label: "Supabase service role key",
    risk: "It skips every database rule: anyone who has it can read and change all of the project's data.",
    fix: "Rotate the project's keys in the Supabase dashboard (Project settings, API) and update the apps that use them.",
    revokeUrl: "https://supabase.com/dashboard",
  },
  private_key: {
    label: "Private key",
    risk: "Anyone who has it can sign in to the servers, or sign as the service, that trust it.",
    fix: "Make a new key pair, then remove the old public key everywhere it is trusted.",
    revokeUrl: null,
  },
  database_url: {
    label: "Database password",
    risk: "Anyone who has it can connect to the database in the address and read or change its data.",
    fix: "Change the database user's password, then update the apps that use it.",
    revokeUrl: null,
  },
  env_secret: {
    label: "Secret setting",
    risk: "A setting named as a password, token or key, with a value that looks real. Anyone who has it can use whatever it unlocks.",
    fix: "Change the value wherever it is used, then update the apps that read it.",
    revokeUrl: null,
  },
};

/** One secret found in one piece of text. */
export type SecretMatch = {
  kind: SecretKind;
  /** 1-based line the secret starts on. */
  line: number;
  /** Where the secret itself is in the text, end exclusive: the part to remove. */
  start: number;
  end: number;
  /** A masked form that is safe to show and store, e.g. "ghp_…3f9a". */
  preview: string;
  /** Keyed hash of the secret, to recognise the same one again. Never the secret. */
  fingerprint: string;
  /** Ziki agent keys only: SHA-256 of the key, as `AgentApiKey.keyHash` stores it. */
  zikiKeyHash?: string;
};

/** A secret found in one named field of a post. */
export type FieldSecretMatch = SecretMatch & { field: string };

type Rule = {
  kind: SecretKind;
  /** A global pattern. Without `value`, the whole match is the secret. */
  pattern: RegExp;
  /**
   * The capture group that holds the secret, when the match is wider than it.
   * Group 1 is then everything from the start of the match up to the secret,
   * so where the secret starts can be worked out without the `d` flag.
   */
  value?: number;
  /** The random part to judge for placeholders: the value after its fixed prefix. */
  body?: (value: string) => string;
  /** Any further check the shape needs. */
  accept?: (value: string, match: RegExpMatchArray) => boolean;
  /** How it is shown. Defaults to the value's prefix and last four characters. */
  preview?: (value: string, match: RegExpMatchArray) => string;
};

// A token can't run on from, or into, more token characters.
const B = "(?<![A-Za-z0-9_-])";
const E = "(?![A-Za-z0-9_-])";

const afterPrefix = (prefix: RegExp) => (value: string) => value.replace(prefix, "");

const RULES: Rule[] = [
  {
    // The whole block, header to footer, is the secret (and what redaction removes).
    kind: "private_key",
    // Group 1 is the key's type, group 2 its body.
    pattern: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?)-----((?:\r?\n(?:[A-Za-z0-9+/=]+|[A-Za-z-]+: [^\r\n]*)?)+?)(?:-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----|(?=\r?\n\s*\r?\n)|$)/g,
    // A mention of the header alone, or a block of dots, is not a key.
    accept: (_value, match) => /[A-Za-z0-9+/]{40}/.test((match[2] ?? "").replace(/\s+/g, "")),
    body: (value) => value.replace(/-----[A-Z ]+-----/g, "").replace(/^[A-Za-z-]+: .*$/gm, "").replace(/\s+/g, ""),
    preview: (_value, match) => `-----BEGIN ${match[1] ?? "PRIVATE KEY"}-----`,
  },
  {
    kind: "ziki_agent_key",
    pattern: new RegExp(`${B}ziki_[A-Za-z0-9_-]{40,60}${E}`, "g"),
    body: afterPrefix(/^ziki_/),
  },
  {
    kind: "github_token",
    pattern: new RegExp(`${B}(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{60,251})${E}`, "g"),
    body: afterPrefix(/^(?:gh[pousr]_|github_pat_)/),
  },
  {
    kind: "gitlab_token",
    pattern: new RegExp(`${B}glpat-[A-Za-z0-9_-]{20,}${E}`, "g"),
    body: afterPrefix(/^glpat-/),
  },
  {
    kind: "aws_access_key",
    pattern: /(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g,
    body: (value) => value.slice(4),
  },
  {
    kind: "aws_secret_key",
    pattern: /(aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']?)([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/gi,
    value: 2,
  },
  {
    kind: "google_api_key",
    pattern: new RegExp(`${B}AIza[0-9A-Za-z_-]{35}${E}`, "g"),
    body: (value) => value.slice(4),
  },
  {
    kind: "google_oauth_secret",
    pattern: new RegExp(`${B}GOCSPX-[A-Za-z0-9_-]{28}${E}`, "g"),
    body: afterPrefix(/^GOCSPX-/),
  },
  {
    kind: "stripe_key",
    pattern: /(?<![A-Za-z0-9_])(?:sk|rk)_live_[0-9A-Za-z]{20,}(?![A-Za-z0-9])/g,
    body: afterPrefix(/^(?:sk|rk)_live_/),
  },
  {
    kind: "slack_token",
    pattern: new RegExp(`${B}xox[abposr]-[0-9]{6,}-[0-9A-Za-z-]{10,}${E}`, "g"),
    body: afterPrefix(/^xox[abposr]-/),
  },
  {
    kind: "slack_webhook",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/g,
    body: (value) => value.split("/").pop() ?? value,
    preview: (value) => `${value.split("/").slice(0, 6).join("/")}/…${value.slice(-4)}`,
  },
  {
    kind: "anthropic_key",
    pattern: new RegExp(`${B}sk-ant-(?:api|admin)\\d{2}-[A-Za-z0-9_-]{20,}${E}`, "g"),
    body: afterPrefix(/^sk-ant-(?:api|admin)\d{2}-/),
  },
  {
    kind: "openai_key",
    pattern: new RegExp(`${B}(?:sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})${E}`, "g"),
    body: afterPrefix(/^sk-(?:proj-|svcacct-|admin-)?/),
  },
  {
    kind: "huggingface_token",
    pattern: new RegExp(`${B}hf_[A-Za-z0-9]{34,}${E}`, "g"),
    body: afterPrefix(/^hf_/),
  },
  {
    kind: "npm_token",
    pattern: new RegExp(`${B}npm_[A-Za-z0-9]{36}${E}`, "g"),
    body: afterPrefix(/^npm_/),
  },
  {
    kind: "sendgrid_key",
    pattern: new RegExp(`${B}SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}${E}`, "g"),
    body: afterPrefix(/^SG\./),
  },
  {
    kind: "telegram_bot_token",
    pattern: /(?<![0-9A-Za-z:])\d{8,10}:AA[0-9A-Za-z_-]{33}(?![0-9A-Za-z_-])/g,
    body: (value) => value.split(":")[1] ?? value,
    preview: (value) => `${value.split(":")[0]}:AA…${value.slice(-4)}`,
  },
  {
    kind: "supabase_service_key",
    pattern: new RegExp(`${B}eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{20,}${E}`, "g"),
    // Only a token that grants the service role. Ordinary sign-in tokens and
    // Supabase's public "anon" key are meant to be seen, and are not reported.
    accept: (value) => jwtRole(value) === "service_role",
    body: (value) => value.split(".")[2] ?? value,
    preview: (value) => `${value.slice(0, 6)}… (service_role)`,
  },
  {
    kind: "database_url",
    // Groups: 1 "scheme://user:", 2 scheme, 3 user, 4 the password, 5 the host.
    pattern: /(?<![A-Za-z0-9+.-])((postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|cockroachdb):\/\/([^\s:/@'"`<>]+):)([^\s@/'"`<>]+)@([^\s/:'"`<>?#,;)]+)/gi,
    value: 4,
    // Local development addresses (the README's own) are not secrets: only a
    // real host with a domain counts.
    accept: (_value, match) => isRemoteHost(match[5] ?? ""),
    preview: (_value, match) => `${match[2]}://${match[3]}:••••@${match[5]}`,
  },
];

/** A name that says its value is a secret: AUTH_SECRET, apiKey, DB_PASSWORD. */
/** Groups: 1 everything before the value, 2 the name, 3 the value. */
const SECRET_SETTING =
  /(?<![A-Za-z0-9_])(([A-Za-z][A-Za-z0-9_.-]{0,60}?(?:secret|token|passw(?:or)?d|passwd|pwd|api_?key|apikey|access_?key|private_?key|signing_?key|auth_?key)[A-Za-z0-9_]{0,30})["']?\s*(?:=|:)\s*["']?)([^\s"'`,;<>]{16,200})/gi;

const SAME_LINE = /\r?\n/g;

/**
 * Every secret in `text`, in order. Overlapping finds keep the more specific
 * rule: a GitHub token on an `API_TOKEN=` line is one GitHub token.
 */
export function findSecrets(text: string): SecretMatch[] {
  if (!text) return [];
  const found: SecretMatch[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const start = (match.index ?? 0) + (rule.value ? (match[1] ?? "").length : 0);
      const value = rule.value ? match[rule.value] ?? "" : match[0];
      const end = start + value.length;
      if (!value) continue;
      if (rule.accept && !rule.accept(value, match)) continue;
      if (looksLikePlaceholder(rule.body ? rule.body(value) : value)) continue;
      if (overlaps(found, start, end)) continue;
      found.push(describe(rule.kind, text, start, end, rule.preview ? rule.preview(value, match) : maskSecret(value)));
    }
  }
  for (const match of text.matchAll(SECRET_SETTING)) {
    const value = match[3] ?? "";
    const start = (match.index ?? 0) + (match[1] ?? "").length;
    const end = start + value.length;
    if (overlaps(found, start, end)) continue;
    if (!looksLikeSecretValue(value)) continue;
    found.push(describe("env_secret", text, start, end, `${match[2] ?? ""}=${maskSecret(value)}`));
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Every secret in a post's fields, in the order the fields were given. Empty fields are skipped. */
export function findSecretsInFields(
  fields: Record<string, string | null | undefined> | ReadonlyArray<{ field: string; text: string }>,
): FieldSecretMatch[] {
  const entries = Array.isArray(fields)
    ? fields.map(({ field, text }) => [field, text] as const)
    : Object.entries(fields as Record<string, string | null | undefined>);
  const found: FieldSecretMatch[] = [];
  for (const [field, text] of entries) {
    if (typeof text !== "string" || !text) continue;
    for (const match of findSecrets(text)) found.push({ ...match, field });
  }
  return found;
}

/**
 * The text with the secrets removed, each replaced by a short note saying
 * what was there. `only` limits it to secrets with those fingerprints.
 */
export function redactSecrets(text: string, only?: ReadonlySet<string>): { text: string; removed: number } {
  const matches = findSecrets(text).filter((m) => !only || only.has(m.fingerprint));
  if (matches.length === 0) return { text, removed: 0 };
  let out = "";
  let at = 0;
  for (const match of matches) {
    out += text.slice(at, match.start) + `[removed: ${SECRET_KINDS[match.kind].label}]`;
    at = match.end;
  }
  return { text: out + text.slice(at), removed: matches.length };
}

/**
 * A form that is safe to show: the vendor's prefix (which is no secret) and
 * the last few characters, never enough of the random part to help a guess.
 */
export function maskSecret(value: string): string {
  const prefix = /^(?:github_pat_|sk-ant-(?:api|admin)\d{2}-|sk-(?:proj|svcacct|admin)-|(?:sk|rk)_live_|gh[pousr]_|ziki_|glpat-|GOCSPX-|xox[abposr]-|npm_|hf_|SG\.|AKIA|ASIA|AIza)/.exec(value);
  const rest = prefix ? value.length - prefix[0].length : value.length;
  if (rest <= 12) return `${prefix ? prefix[0] : value.slice(0, 2)}…`;
  const tail = rest >= 24 ? 4 : 2;
  const head = prefix ? prefix[0] : value.slice(0, tail);
  return `${head}…${value.slice(-tail)}`;
}

/**
 * A keyed hash of a secret, so the alerts table can recognise the same secret
 * again without holding anything that could be guessed back offline.
 */
export function fingerprintSecret(value: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "ziki-local-development";
  return createHmac("sha256", `ziki-secret-fingerprint:${secret}`).update(value, "utf8").digest("hex");
}

/** Whether a value reads as a placeholder, an example or a pattern rather than a working secret. */
export function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  if (/x{4,}|\*{3,}|•{2,}|\.{3,}|…|_{4,}|-{4,}|<[^>]*>|\{\{|\$\{|%s|%\(/i.test(value)) return true;
  // Words a person types into an example. A long random value (a private key,
  // a signature) can hold one of these by chance, so only short ones are read.
  if (value.length <= 64 && /example|sample|placeholder|your[_-]?|changeme|change[_-]me|replace[_-]?me|dummy|fake|redacted|removed|insert|secret[_-]?here|key[_-]?here|token[_-]?here|test|demo/i.test(value)) return true;
  if (/0123456789|1234567890|abcdefghij|qwertyuiop/i.test(value)) return true;
  // One or two characters repeated, or far too little variety to be random.
  const distinct = new Set(value).size;
  if (distinct <= 2) return true;
  if (value.length >= 16 && distinct < 6) return true;
  return entropy(value) < 3;
}

/** Shannon entropy in bits per character. Random tokens score about 4.5 to 6. */
export function entropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A value after a secret-sounding name that is a real value, not a reference, a path or a word. */
function looksLikeSecretValue(value: string): boolean {
  if (/:\/\/|^\.{0,2}\/|^process\.env|^env\.|^os\.environ|^\$|^%|^@|^\(/.test(value)) return false;
  if (/^(?:true|false|null|undefined|none|required|optional|string|number)$/i.test(value)) return false;
  if (looksLikePlaceholder(value)) return false;
  // Letters and digits both, and random enough to be generated rather than
  // written: a model name or a sentence fragment has no digits, or too few.
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false;
  return entropy(value) >= 3.5;
}

function isRemoteHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".")) return false;
  if (/^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|host\.docker\.internal)$/.test(h)) return false;
  if (/\.(?:local|localhost|internal|test|example|invalid)$/.test(h) || /(?:^|\.)example\.(?:com|org|net)$/.test(h)) return false;
  // Private network addresses are not reachable from outside, but a leaked
  // password to one is still a password: only loopback is skipped above.
  return true;
}

/** The `role` claim of a JSON web token, without verifying it. */
function jwtRole(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

function overlaps(found: readonly SecretMatch[], start: number, end: number): boolean {
  return found.some((m) => start < m.end && end > m.start);
}

function describe(kind: SecretKind, text: string, start: number, end: number, preview: string): SecretMatch {
  const value = text.slice(start, end);
  const line = (text.slice(0, start).match(SAME_LINE)?.length ?? 0) + 1;
  return {
    kind,
    line,
    start,
    end,
    preview,
    fingerprint: fingerprintSecret(value),
    ...(kind === "ziki_agent_key" ? { zikiKeyHash: createHash("sha256").update(value, "utf8").digest("hex") } : {}),
  };
}

/**
 * The sentence a person or agent sees when a post is stopped. It names what
 * was found and where, never the secret, and says how to post anyway.
 */
export function secretBlockedMessage(found: readonly FieldSecretMatch[], noun = "this"): string {
  if (found.length === 0) return "";
  const where = (m: FieldSecretMatch) => `${m.field === "body" || m.field === "description" ? "" : `${fieldLabel(m.field)}, `}line ${m.line}: ${m.preview}`;
  const first = found[0];
  const what = found.length === 1
    ? `This looks like ${article(SECRET_KINDS[first.kind].label)} ${SECRET_KINDS[first.kind].label} (${where(first)}).`
    : `This has ${found.length} secrets in it: ${found.slice(0, 3).map((m) => `${article(SECRET_KINDS[m.kind].label)} ${SECRET_KINDS[m.kind].label} (${where(m)})`).join(", ")}${found.length > 3 ? " and more" : ""}.`;
  return `${what} Anyone who can read ${noun} could use it, so nothing was posted. Remove it and post again. If it's only an example, change part of it to xxxx.`;
}

function fieldLabel(field: string): string {
  return field.replace(/\[(\d+)\]/g, " $1").replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) && !/^(?:one|use)/i.test(label) ? "an" : "a";
}
