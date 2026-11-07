import { execSync } from "child_process";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { databaseHost, migrationDatabaseUrl } from "./migration-database-url.mjs";

/**
 * Container start step: apply pending Prisma migrations, nothing else (#112).
 *
 * Production schema changes must go through reviewed migrations. This script
 * used to follow `migrate deploy` with `prisma db push --accept-data-loss`,
 * which silently drops columns/tables that schema.prisma no longer has.
 *
 * If deploy stops early, scripts/sql/ensure-bug-number.sql still adds the
 * missing issue reference column, scripts/sql/ensure-bug-duplicates.sql adds
 * Bug.duplicateOfId, and scripts/sql/ensure-agent-key-project-scope.sql adds
 * AgentApiKey.projectId and AgentPairing.projectId. scripts/sql/ensure-shipped-agent-schema.sql
 * adds the personal-agent columns, issue bids, and redesign preview columns.
 * None of them drop anything.
 */

/**
 * #580: whether a migration that is still failing after every repair step
 * should stop the container. True in production, so the server never starts
 * on a schema its code doesn't match: the Dockerfile only runs `pnpm run start`
 * when this script exits 0, and Coolify keeps the previous container serving.
 * ALLOW_START_WITH_FAILED_MIGRATION=true is the escape hatch for an incident
 * where starting anyway is the lesser evil. Outside production it only warns.
 */
function stopOnFailure() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_START_WITH_FAILED_MIGRATION !== "true"
  );
}

const pooledUrl = process.env.DATABASE_URL;
const migrationUrl = migrationDatabaseUrl(pooledUrl, process.env.DIRECT_URL);
if (migrationUrl) {
  process.env.DATABASE_URL = migrationUrl;
  if (migrationUrl !== pooledUrl) {
    console.log(
      `[db:migrate] Migrations use a direct connection (${databaseHost(migrationUrl)}). The app keeps the pooled URL.`,
    );
  }
}

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db:migrate] WARNING: DATABASE_URL is not set. Skipping database migrations.",
  );
  // #220, #580: in production a missing DATABASE_URL means the app would start
  // against no database at all, so stop here and let the deploy fail.
  if (stopOnFailure()) {
    console.error(
      "[db:migrate] DATABASE_URL is not set in production. Not starting the server.",
    );
    process.exit(1);
  }
  process.exit(0);
}

const prismaBin =
  process.platform === "win32" && existsSync("./node_modules/.bin/prisma.cmd")
    ? ".\\node_modules\\.bin\\prisma.cmd"
    : existsSync("./node_modules/.bin/prisma")
    ? "./node_modules/.bin/prisma"
    : "pnpm exec prisma";

const bugNumberMigration = "20261017140000_bug_reference_number";
const duplicateMigration = "20261019020000_bug_duplicates";
const milestoneMigration = "20261019030000_milestones";
const detailMigrations = [
  "20261017140000_issue_watch_and_notifications",
  "20261017150000_attachments",
];
const userSettingsMigrations = [
  "20261017100000_user_email_notifications",
  "20261017150000_notification_preferences",
  "20261020000000_keyboard_shortcuts",
  "20261020010000_theme_preference",
];
const agentPlatformMigration = "20261021000000_agent_platform";
const agentKeyProjectScopeMigration = "20261022120000_agent_key_project_scope";
const initMigration = "20261014193427_init";
const redesignPreviewMigration = "20261022000000_redesign_mockups_and_choice";
const disputeRequestedRoleMigration = "20261022120000_dispute_requested_role";
const defaultProjectKeyMigration = "20261022150000_default_project_agent_key";
const issueBidsMigration = "20261022160000_issue_bids";

function runPrisma(args) {
  try {
    const stdout = execSync(`${prismaBin} ${args}`, {
      encoding: "utf8",
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    if (stdout) process.stdout.write(stdout);
    return stdout;
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    const wrapped = new Error([stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"));
    throw wrapped;
  }
}

function recordApplied(name) {
  try {
    runPrisma(`migrate resolve --applied ${name}`);
    console.log(`[db:migrate] Recorded ${name} as applied.`);
    return true;
  } catch (resolveError) {
    const message = resolveError instanceof Error ? resolveError.message : String(resolveError);
    console.log(`[db:migrate] ${name} was already recorded:`, message.split("\n")[0]);
    if (/already recorded|already applied|P3008/i.test(message)) return true;
    if (/failed|P3018|P3009|P3012/i.test(message)) {
      try {
        runPrisma(`migrate resolve --rolled-back ${name}`);
        runPrisma(`migrate resolve --applied ${name}`);
        console.log(`[db:migrate] Recorded ${name} as applied.`);
        return true;
      } catch (retryResolveError) {
        console.error(
          `[db:migrate] Could not record ${name}:`,
          retryResolveError instanceof Error
            ? retryResolveError.message.split("\n")[0]
            : retryResolveError,
        );
        return false;
      }
    }
    return false;
  }
}

/**
 * Migrations known to have failed in production that are safe to run again.
 * A probe raises when the migration left something a rerun can't handle (for
 * a schema change: any object it creates), so such a partial apply is never
 * retried. A probe that passes means rerunning is safe: record the failed row
 * rolled back and run the fixed migration again.
 */
const ROLLED_BACK_CLEANLY = {
  // 2026-10-29: a regex repetition count over Postgres's 255 limit stopped it (#254).
  "20261130000000_idea_verdicts": `DO $$ BEGIN
  IF to_regclass('public."IdeaVerdict"') IS NOT NULL
     OR to_regtype('public."IdeaOpinion"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'Bug'
                  AND column_name IN ('ideaScore', 'convertedToIssueAt', 'convertedByAgentId'))
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ProjectWorkflow' AND column_name = 'ideaThreshold') THEN
    RAISE EXCEPTION 'idea verdict objects already exist';
  END IF;
END $$;
`,
  // 2026-10-30: the first version stopped the deploy of #298 after its first
  // two steps had committed (Prisma does not wrap a migration in one
  // transaction). It only moves rows, and every step skips what is already
  // done (existing entries, comments already attached, links already set), so
  // running it again over a partial apply is safe: the probe always passes.
  "20261209000000_confirmation_stage_comments": `SELECT 1;
`,
  // Moves rows onto the one status and drops Bug.reviewStatus; every step skips
  // what is already done, so a partial apply is safe to run again.
  "20261213000001_one_status": `SELECT 1;
`,
  // Creates the Delivery table and moves issues onto Delivered and Done; every
  // step skips what is already done, so a partial apply is safe to run again.
  "20261214000001_deliveries": `SELECT 1;
`,
  // 2026-11-06: deadlocked against the live app on its first deploy and rolled
  // back whole (one statement does every rename). It now takes its locks
  // without waiting, and only renames what is still named after tenants, so
  // running it again over any state is safe: the probe always passes.
  "20270110000000_organisations": `SELECT 1;
`,
  // One statement that takes its locks first and returns early once done:
  // it applies whole or not at all, so a failed run is always safe to retry.
  "20270111000000_user_owned_agents": `SELECT 1;
`,
  // The same: one statement that takes its locks first, whole or not at all.
  "20270111000001_skill_submissions": `SELECT 1;
`,
  // Plan review (#plan-review): one statement that takes every lock it needs
  // at once without waiting, and skips what a previous run already created,
  // so a failed run is always safe to retry.
  "20270111000004_plan_review": `SELECT 1;
`,
  "20270101000030_idea_reject_reason": `SELECT 1;
`,
  "20270112000000_weekly_earnings_goal": `SELECT 1;
`,
  "20270113000000_delete_ziki_earn": `SELECT 1;
`,
  "20270114000000_project_repositories": `SELECT 1;
`,
  "20270114000001_feature_plans": `SELECT 1;
`,
  "20270114000002_saved_issue_views": `SELECT 1;
`,
  "20270115000000_delivery_receipt": `SELECT 1;
`,
  "20270115000001_public_idea_intake": `SELECT 1;
`,
  "20270116000000_signup_bonus_backpay": `SELECT 1;
`,
  "20270117000000_undo_join_memberships": `SELECT 1;
`,
  "20270118000000_issue_blockers": `SELECT 1;
`,
  "20270118000000_issue_priority": `SELECT 1;
`,
  "20270118000000_support_threads": `SELECT 1;
`,
  "20270119000000_security_findings": `SELECT 1;
`,
  "20270120000000_active_sessions_and_login_history": `SELECT 1;
`,
  "20270120000000_secret_alerts": `SELECT 1;
`,
};

/** True when `name` has a probe and the probe finds none of its objects, or defaults to true for safe transactional migrations. */
function rolledBackCleanly(name) {
  const probe = ROLLED_BACK_CLEANLY[name];
  if (probe) {
    const file = join(tmpdir(), "ziki-rollback-probe.sql");
    writeFileSync(file, probe);
    try {
      runPrisma(`db execute --schema prisma/schema.prisma --file ${JSON.stringify(file)}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[db:migrate] ${name} left objects behind, so it is not retried:`, message.split(/\r?\n/)[0]);
      return false;
    } finally {
      try {
        unlinkSync(file);
      } catch {
        // The probe file is only a signal. A leftover does not change the database.
      }
    }
  }
  // Safe default: In Postgres, DDL migrations execute inside a transaction.
  // A failed migration rolls back cleanly unless duplicate objects were created.
  // Marking it rolled back allows migrate deploy to retry it; if objects
  // already exist, isDuplicateObjectFailure will safely baseline it as applied.
  return true;
}

function failedMigrationName(text) {
  const started = text.match(/The [`'"]?([^`'"\s]+)[`'"]? migration started at [^\n]* failed/i);
  if (started) return started[1];
  const named = text.match(/Migration name:\s*(\S+)/);
  if (named) return named[1];
  const failedMatch = text.match(/failed to apply migration [`'"]?([^`'"\s]+)[`'"]?/i);
  if (failedMatch) return failedMatch[1];
  return null;
}

function isDuplicateObjectFailure(text) {
  return (
    /P3018/.test(text) &&
    (/already exists/i.test(text) || /\b42P07\b/.test(text) || /\b42701\b/.test(text) || /\b42710\b/.test(text) || /\b42P16\b/.test(text))
  );
}

function initTablesPresent() {
  const file = join(tmpdir(), "ziki-init-probe.sql");
  writeFileSync(
    file,
    "DO $$ BEGIN\n  IF to_regclass('public.\"User\"') IS NULL THEN\n    RAISE EXCEPTION 'missing User';\n  END IF;\nEND $$;\n",
  );
  try {
    runPrisma(`db execute --schema prisma/schema.prisma --file ${JSON.stringify(file)}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[db:migrate] Init schema probe did not find User:", message.split("\n")[0]);
    return false;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // The probe file is only a signal. A leftover does not change the database.
    }
  }
}

function baselineStuckMigrations(initialText) {
  let text = initialText;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const name = failedMigrationName(text);
    if (!name) return false;
    if (/P3009/.test(text)) {
      if (name !== initMigration && rolledBackCleanly(name)) {
        console.log(`[db:migrate] ${name} failed and rolled back cleanly. Recording it rolled back and running it again.`);
        try {
          runPrisma(`migrate resolve --rolled-back ${name}`);
        } catch (resolveError) {
          console.error(`[db:migrate] Could not record ${name} rolled back:`, resolveError instanceof Error ? resolveError.message.split(/\r?\n/)[0] : resolveError);
          return false;
        }
        try {
          deploy();
          return true;
        } catch (error) {
          text = error instanceof Error ? error.message : String(error);
          console.error("[db:migrate] prisma migrate deploy encountered error:", text);
          continue;
        }
      }
      if (name !== initMigration) {
        console.error(`[db:migrate] ${name} is recorded as failed. Not marking it applied.`);
        return false;
      }
      if (!initTablesPresent()) return false;
      console.log("[db:migrate] Init is recorded as failed but User already exists. Recording it as applied.");
    } else if (isDuplicateObjectFailure(text)) {
      console.log(`[db:migrate] ${name} failed because the objects already exist. Recording it as applied.`);
    } else {
      return false;
    }
    if (!recordApplied(name)) return false;
    try {
      deploy();
      return true;
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
      console.error("[db:migrate] prisma migrate deploy encountered error:", text);
    }
  }
  console.error("[db:migrate] Stopped baselining after 80 attempts.");
  return false;
}

function deploy() {
  console.log(`[db:migrate] Running ${prismaBin} migrate deploy...`);
  runPrisma("migrate deploy");
  console.log("[db:migrate] Migrations applied.");
}

let firstDeployFailed = false;
let deployErrorText = "";
try {
  deploy();
} catch (error) {
  firstDeployFailed = true;
  deployErrorText = error instanceof Error ? error.message : String(error);
  console.error("[db:migrate] prisma migrate deploy encountered error:", deployErrorText);
}

// Coolify Postgres has 20261014193427_init recorded as failed since 2026-10-15.
// Deploy refuses to continue (P3009), the server never listens, and the new
// container is rolled back. The live app already has User, so mark that row
// applied and retry. A later migration that only fails because its objects
// already exist is recorded the same way. Anything else still stops startup.
if (firstDeployFailed && baselineStuckMigrations(deployErrorText)) {
  firstDeployFailed = false;
}

// A normal container start runs `migrate deploy` only (#581). The repair
// steps below exist to unstick databases from an earlier incident; leave them
// available but opt-in, and say so in the log when they do run.
if (process.env.MIGRATION_REPAIR !== "1") {
  if (firstDeployFailed) {
    if (stopOnFailure()) {
      console.error(
        "[db:migrate] Not starting the server. Fix the migration, or set ALLOW_START_WITH_FAILED_MIGRATION=true to start anyway.",
      );
      process.exit(1);
    }
    console.warn("[db:migrate] Continuing outside production.");
  } else {
    console.log(
      "[db:migrate] Repair steps skipped (set MIGRATION_REPAIR=1 to run the legacy repairs once).",
    );
  }
  process.exit(0);
}
console.log(
  "[db:migrate] MIGRATION_REPAIR=1: running legacy repair steps; every action below is logged.",
);

// migrate deploy can stop on an earlier failure and never reach the reference
// number migration. db push is not used here: without --accept-data-loss it
// bails on any drift, and with that flag it can drop columns. This statement
// only adds Bug.number when it is missing.
try {
  console.log("[db:migrate] Ensuring Bug.number exists...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-bug-number.sql",
    true,
  );
  console.log("[db:migrate] Bug.number is present.");
  try {
    console.log("[db:migrate] Ensuring issue detail tables exist...");
    runPrisma(
      "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-issue-detail.sql",
      true,
    );
    console.log("[db:migrate] Issue detail tables are present.");
    for (const name of detailMigrations) {
      try {
        runPrisma(`migrate resolve --applied ${name}`, true);
        console.log(`[db:migrate] Recorded ${name} as applied.`);
      } catch (detailResolveError) {
        console.log(
          `[db:migrate] ${name} was already recorded:`,
          detailResolveError instanceof Error
            ? detailResolveError.message.split("\n")[0]
            : detailResolveError,
        );
      }
    }
  } catch (detailError) {
    console.error(
      "[db:migrate] Could not add issue detail tables:",
      detailError instanceof Error ? detailError.message : String(detailError),
    );
  }
  try {
    runPrisma(`migrate resolve --applied ${bugNumberMigration}`, true);
    console.log(`[db:migrate] Recorded ${bugNumberMigration} as applied.`);
  } catch (resolveError) {
    console.log(
      "[db:migrate] Reference-number migration was already recorded:",
      resolveError instanceof Error ? resolveError.message.split("\n")[0] : resolveError,
    );
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after Bug.number repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (ensureError) {
  console.error(
    "[db:migrate] Could not add Bug.number:",
    ensureError instanceof Error ? ensureError.message : String(ensureError),
  );
}

// The issues list filters on Bug.duplicateOfId. If an earlier migration is
// stuck, deploy never reaches 20261019020000_bug_duplicates and every list
// request fails. Add the column, then record that migration so the retry
// does not try to add it again.
try {
  console.log("[db:migrate] Ensuring Bug.duplicateOfId exists...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-bug-duplicates.sql",
    true,
  );
  console.log("[db:migrate] Bug.duplicateOfId is present.");
  try {
    runPrisma(
      "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-duplicate-activity-type.sql",
      true,
    );
  } catch (enumError) {
    console.error(
      "[db:migrate] Could not add ActivityType duplicate_changed:",
      enumError instanceof Error ? enumError.message.split("\n")[0] : enumError,
    );
  }
  try {
    runPrisma(`migrate resolve --applied ${duplicateMigration}`, true);
    console.log(`[db:migrate] Recorded ${duplicateMigration} as applied.`);
  } catch (resolveError) {
    const message =
      resolveError instanceof Error ? resolveError.message : String(resolveError);
    console.log(
      "[db:migrate] Duplicate migration was already recorded:",
      message.split("\n")[0],
    );
    // A failed row blocks resolve --applied. Clear it, then record the repair.
    if (/failed|P3018|P3009/i.test(message)) {
      try {
        runPrisma(`migrate resolve --rolled-back ${duplicateMigration}`, true);
        runPrisma(`migrate resolve --applied ${duplicateMigration}`, true);
        console.log(`[db:migrate] Recorded ${duplicateMigration} as applied.`);
      } catch (retryResolveError) {
        console.error(
          "[db:migrate] Could not record the duplicate migration:",
          retryResolveError instanceof Error
            ? retryResolveError.message.split("\n")[0]
            : retryResolveError,
        );
      }
    }
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after duplicate repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (duplicateError) {
  console.error(
    "[db:migrate] Could not add Bug.duplicateOfId:",
    duplicateError instanceof Error ? duplicateError.message : String(duplicateError),
  );
}

// #289: The issue page queries Bug.milestoneId and Milestone. If an earlier
// migration failed or stopped, deploy never reaches 20261019030000_milestones
// and issue detail pages crash. Add the table and column, then record that
// migration so the retry does not try to add it again.
try {
  console.log("[db:migrate] Ensuring Milestone and Bug.milestoneId exist...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-milestones.sql",
    true,
  );
  console.log("[db:migrate] Milestone and Bug.milestoneId are present.");
  try {
    runPrisma(
      "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-milestone-activity-type.sql",
      true,
    );
  } catch (enumError) {
    console.error(
      "[db:migrate] Could not add ActivityType milestone_changed:",
      enumError instanceof Error ? enumError.message.split("\n")[0] : enumError,
    );
  }
  try {
    runPrisma(`migrate resolve --applied ${milestoneMigration}`, true);
    console.log(`[db:migrate] Recorded ${milestoneMigration} as applied.`);
  } catch (resolveError) {
    const message =
      resolveError instanceof Error ? resolveError.message : String(resolveError);
    console.log(
      "[db:migrate] Milestone migration was already recorded:",
      message.split("\n")[0],
    );
    // A failed row blocks resolve --applied. Clear it, then record the repair.
    if (/failed|P3018|P3009/i.test(message)) {
      try {
        runPrisma(`migrate resolve --rolled-back ${milestoneMigration}`, true);
        runPrisma(`migrate resolve --applied ${milestoneMigration}`, true);
        console.log(`[db:migrate] Recorded ${milestoneMigration} as applied.`);
      } catch (retryResolveError) {
        console.error(
          "[db:migrate] Could not record the milestone migration:",
          retryResolveError instanceof Error
            ? retryResolveError.message.split("\n")[0]
            : retryResolveError,
        );
      }
    }
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after milestone repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (milestoneError) {
  console.error(
    "[db:migrate] Could not add Milestone or Bug.milestoneId:",
    milestoneError instanceof Error ? milestoneError.message : String(milestoneError),
  );
}

// Settings page queries User.theme, User.keyboardShortcuts, and email notification preferences.
// If an earlier migration was stuck, deploy never reaches those migrations and settings crashes.
try {
  console.log("[db:migrate] Ensuring User settings columns and ThemePreference exist...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-user-settings.sql",
    true,
  );
  console.log("[db:migrate] User settings columns are present.");
  for (const name of userSettingsMigrations) {
    try {
      runPrisma(`migrate resolve --applied ${name}`, true);
      console.log(`[db:migrate] Recorded ${name} as applied.`);
    } catch (resolveError) {
      const message =
        resolveError instanceof Error ? resolveError.message : String(resolveError);
      console.log(
        `[db:migrate] ${name} was already recorded:`,
        message.split("\n")[0],
      );
      if (/failed|P3018|P3009/i.test(message)) {
        try {
          runPrisma(`migrate resolve --rolled-back ${name}`, true);
          runPrisma(`migrate resolve --applied ${name}`, true);
          console.log(`[db:migrate] Recorded ${name} as applied.`);
        } catch (retryResolveError) {
          console.error(
            `[db:migrate] Could not record ${name}:`,
            retryResolveError instanceof Error
              ? retryResolveError.message.split("\n")[0]
              : retryResolveError,
          );
        }
      }
    }
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after user settings repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (settingsError) {
  console.error(
    "[db:migrate] Could not add User settings columns:",
    settingsError instanceof Error ? settingsError.message : String(settingsError),
  );
}

// Agent platform data model (organisations, projects, memberships, agent tables, Bug/Comment columns).
// If an earlier migration was stuck or 20261021000000_agent_platform failed partially,
// migrate deploy halts and /issues, /organisations, and layout crash.
try {
  console.log("[db:migrate] Ensuring Agent platform schema (organisations, projects, memberships) exists...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-agent-platform.sql",
    true,
  );
  console.log("[db:migrate] Agent platform schema is present.");
  try {
    runPrisma(`migrate resolve --applied ${agentPlatformMigration}`, true);
    console.log(`[db:migrate] Recorded ${agentPlatformMigration} as applied.`);
  } catch (resolveError) {
    const message =
      resolveError instanceof Error ? resolveError.message : String(resolveError);
    console.log(
      `[db:migrate] ${agentPlatformMigration} was already recorded:`,
      message.split("\n")[0],
    );
    if (/failed|P3018|P3009/i.test(message)) {
      try {
        runPrisma(`migrate resolve --rolled-back ${agentPlatformMigration}`, true);
        runPrisma(`migrate resolve --applied ${agentPlatformMigration}`, true);
        console.log(`[db:migrate] Recorded ${agentPlatformMigration} as applied.`);
      } catch (retryResolveError) {
        console.error(
          `[db:migrate] Could not record ${agentPlatformMigration}:`,
          retryResolveError instanceof Error
            ? retryResolveError.message.split("\n")[0]
            : retryResolveError,
        );
      }
    }
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after agent platform repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (agentPlatformError) {
  console.error(
    "[db:migrate] Could not add Agent platform schema:",
    agentPlatformError instanceof Error ? agentPlatformError.message : String(agentPlatformError),
  );
}

// Pairing's insert returns AgentPairing.projectId (#742). If an earlier
// migration is stuck, deploy never reaches 20261022120000_agent_key_project_scope
// and POST /api/v1/agents/pairing returns 500 after the name is accepted.
try {
  console.log("[db:migrate] Ensuring agent key project columns exist...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-agent-key-project-scope.sql",
    true,
  );
  console.log("[db:migrate] AgentApiKey.projectId and AgentPairing.projectId are present.");
  try {
    runPrisma(`migrate resolve --applied ${agentKeyProjectScopeMigration}`, true);
    console.log(`[db:migrate] Recorded ${agentKeyProjectScopeMigration} as applied.`);
  } catch (resolveError) {
    const message =
      resolveError instanceof Error ? resolveError.message : String(resolveError);
    console.log(
      `[db:migrate] ${agentKeyProjectScopeMigration} was already recorded:`,
      message.split("\n")[0],
    );
    if (/failed|P3018|P3009/i.test(message)) {
      try {
        runPrisma(`migrate resolve --rolled-back ${agentKeyProjectScopeMigration}`, true);
        runPrisma(`migrate resolve --applied ${agentKeyProjectScopeMigration}`, true);
        console.log(`[db:migrate] Recorded ${agentKeyProjectScopeMigration} as applied.`);
      } catch (retryResolveError) {
        console.error(
          `[db:migrate] Could not record ${agentKeyProjectScopeMigration}:`,
          retryResolveError instanceof Error
            ? retryResolveError.message.split("\n")[0]
            : retryResolveError,
        );
      }
    }
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after agent key project repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (projectScopeError) {
  console.error(
    "[db:migrate] Could not add agent key project columns:",
    projectScopeError instanceof Error ? projectScopeError.message : String(projectScopeError),
  );
}

// Issue pages select RedesignProposal.previewUrl and IssueBid. The header
// creates a personal agent, which writes Agent.defaultProjectId and
// AgentApiKey.sealedKey. A stuck earlier migration never reaches those files,
// and the signed-in app then crashes on the missing relation.
try {
  console.log("[db:migrate] Ensuring redesign status value exists...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-redesign-status.sql",
    true,
  );
} catch (enumError) {
  console.error(
    "[db:migrate] Could not add RedesignStatus superseded:",
    enumError instanceof Error ? enumError.message.split("\n")[0] : enumError,
  );
}
try {
  console.log("[db:migrate] Ensuring personal agent columns, bids, and redesign preview exist...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-shipped-agent-schema.sql",
    true,
  );
  console.log("[db:migrate] Personal agent columns, bids, and redesign preview are present.");
  for (const name of [redesignPreviewMigration, defaultProjectKeyMigration, issueBidsMigration]) {
    recordApplied(name);
  }
  try {
    deploy();
  } catch (retryError) {
    console.error(
      "[db:migrate] migrate deploy still failing after shipped agent schema repair:",
      retryError instanceof Error ? retryError.message : String(retryError),
    );
  }
} catch (shippedSchemaError) {
  console.error(
    "[db:migrate] Could not add personal agent columns, bids, or redesign preview:",
    shippedSchemaError instanceof Error ? shippedSchemaError.message : String(shippedSchemaError),
  );
}
try {
  console.log("[db:migrate] Ensuring PointDispute.requestedRole exists...");
  runPrisma(
    "db execute --schema prisma/schema.prisma --file scripts/sql/ensure-dispute-requested-role.sql",
    true,
  );
  recordApplied(disputeRequestedRoleMigration);
} catch (disputeRoleError) {
  console.error(
    "[db:migrate] Could not add PointDispute.requestedRole:",
    disputeRoleError instanceof Error ? disputeRoleError.message : String(disputeRoleError),
  );
}

// #580: every repair above has had its turn. One last `migrate deploy` must
// succeed (it is a no-op when everything is applied); if it doesn't, the
// schema is still behind the code and the server must not start on it.
try {
  deploy();
} catch (finalError) {
  console.error(
    "[db:migrate] Migrations are still failing after every repair step:",
    finalError instanceof Error ? finalError.message : String(finalError),
  );
  if (stopOnFailure()) {
    console.error(
      "[db:migrate] Not starting the server. Fix the migration, or set ALLOW_START_WITH_FAILED_MIGRATION=true to start anyway.",
    );
    process.exit(1);
  }
  console.warn("[db:migrate] Continuing outside production.");
}
