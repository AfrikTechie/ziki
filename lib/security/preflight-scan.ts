/**
 * The pre-flight scan (#866, first slice): the known-bad-code check the repository's CI gate runs on its own pull
 * requests (.github/workflows/malware-ci-gate.yml), as a pure function, so a delivered pull request's changed files
 * can be checked the same way before testers open them. It reads text it is given; it fetches nothing and stores
 * nothing. A clean result means no known signature was found in what was sent, not that the code is safe.
 *
 * The patterns are written with a character class around one letter ([x]) so this file does not match its own
 * signatures when the CI gate scans it.
 */
const SIGNATURES: { id: string; pattern: RegExp }[] = [
  { id: "global-bang", pattern: /global\['!'\]/ },
  { id: "marker-a", pattern: /8-2503-[2]/ },
  { id: "marker-b", pattern: /8-318[2]/ },
  { id: "obfuscated-1e42", pattern: /_\$_1e42/ },
  { id: "temp-auto-push", pattern: /temp_auto_pus[h]/ },
  { id: "temp-interactive-push", pattern: /temp_interactive_pus[h]/ },
  { id: "router-init", pattern: /router_init\.js/ },
  { id: "tanstack-setup", pattern: /@tanstack\/setu[p]/ },
  { id: "tanstack-router-hash", pattern: /tanstack\/router#79ac49e[e]/ },
  { id: "campaign-name", pattern: /Polin[R]ider/ },
  { id: "obfuscated-sfl", pattern: /sfL\[EKc\]/ },
  { id: "obfuscated-var", pattern: /var _\$_/ },
  { id: "charcode-split-join", pattern: /String\.fromCharCode.{0,120}split.{0,120}join.{0,120}return/ },
  { id: "node-fonts", pattern: /node \.\/public\/fonts\// },
  { id: "fa-solid-400", pattern: /fa-solid-400\.woff2/ },
  { id: "fa-solid-900", pattern: /fa-solid-900\.woff2/ },
  { id: "branch-structure", pattern: /branch_structure\.json/ },
  { id: "eval-atob", pattern: /eval\(ato[b]\(/ },
  { id: "eval-proxy", pattern: /eval\(proxyInf[o]\)/ },
];

/** File types the CI gate reads; others are not scanned. */
const SCANNED = /\.(js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|bat|sh|py)$|postcss\.config\.|tailwind\.config\.|next\.config\.|\.gitignore$/;
/** Paths the CI gate skips: workflow files hold the patterns as text, and vendored code is not the author's. */
const SKIPPED = /^(\.github\/workflows\/|public\/vendor\/|vendor\/)/;
/** An appended injection sits at the end of a file, so the last lines are also reported on their own. */
const TAIL_LINES = 30;

export type PreflightFinding = { path: string; signature: string; line: number; inTail: boolean };

export function isScanned(path: string): boolean {
  return SCANNED.test(path) && !SKIPPED.test(path);
}

export function scanFile(path: string, content: string): PreflightFinding[] {
  if (!isScanned(path)) return [];
  const lines = content.split("\n");
  const tailStart = Math.max(0, lines.length - TAIL_LINES);
  const findings: PreflightFinding[] = [];
  for (const { id, pattern } of SIGNATURES) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) findings.push({ path, signature: id, line: index + 1, inTail: index >= tailStart });
  }
  return findings;
}

export type PreflightResult = {
  /** "clean": nothing found. "warning": at least one known signature was found. */
  state: "clean" | "warning";
  /** Files in the pull request that were scanned, and how many were not (types the gate doesn't read). */
  scanned: number;
  skipped: number;
  findings: PreflightFinding[];
};

export function preflight(files: readonly { path: string; content: string }[]): PreflightResult {
  const findings: PreflightFinding[] = [];
  let scanned = 0;
  for (const file of files) {
    if (!isScanned(file.path)) continue;
    scanned += 1;
    findings.push(...scanFile(file.path, file.content));
  }
  return { state: findings.length ? "warning" : "clean", scanned, skipped: files.length - scanned, findings };
}
