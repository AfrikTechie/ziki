import type { SkillItem } from "./skills-data";

export interface AgentInfo {
  id: string;
  name: string;
  username?: string;
}

/**
 * Builds a standardized, idempotent smart prompt for registering and applying
 * a skill to an agent or all workspace agents.
 *
 * Ensures:
 * 1. Target agent is explicitly specified (including @username if available).
 * 2. Idempotency check against `GET /api/v1/agents/me/skills`.
 * 3. Prerequisite CLI verification and system instructions injection.
 * 4. Platform sync via `PUT /api/v1/agents/me/skills/{tag}` (tag capped at 40 chars).
 * 5. Clear confirmation output with profile link.
 */
export function buildSmartSkillPrompt(
  skill: SkillItem,
  selectedAgentName: string | undefined,
  agents: AgentInfo[]
): string {
  const isAll = !selectedAgentName || selectedAgentName === "all";
  const matchedAgent = agents.find((a) => a.name === selectedAgentName);
  const targetTag = `Ziki-Verified-${skill.title.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    .slice(0, 40)
    .replace(/-+$/, "");
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://ziki.dev";

  if (isAll) {
    const agentList =
      agents.length > 0
        ? agents
            .map((a) => (a.username ? `@${a.username}` : a.name))
            .join(", ")
        : "All workspace agents";

    return `# Target Agents: ${agentList}
# Skill: ${skill.title}
# Category: ${skill.categoryLabel}
# Registered Tag: ${targetTag}

## Step 1: Idempotency & Version Verification
Before applying or modifying anything:
1. Check if the skill "${targetTag}" is already installed and registered in your workspace or agent configuration.
2. If already installed with the identical specification and version:
   -> Report: "✓ Skill ${targetTag} is already installed and up to date across your agents. No new updates to apply."
   -> Stop execution here.

## Step 2: Prerequisites & Installation
${skill.spec.sampleCommand ? `Verify required tooling:\n$ ${skill.spec.sampleCommand}\n` : ""}
Apply the following system instructions:
"""
${skill.prompt}
"""

## Step 3: Platform Sync (Ziki Agent Profile)
For each active agent in your organisation, sync this skill to their profile using your existing Ziki agent connection:
\`\`\`bash
curl -s -X PUT "${origin}/api/v1/agents/me/skills/${encodeURIComponent(targetTag)}" \\
  -H "Authorization: Bearer \$ZIKI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": ${JSON.stringify(skill.description.slice(0, 120))},
    "description": ${JSON.stringify(skill.spec.overview || skill.description)}
  }'
\`\`\`

## Step 4: Final Confirmation
Output to the user:
"✓ Successfully applied ${targetTag} across your active Ziki agents!"`;
  }

  const agentLabel = matchedAgent
    ? `${matchedAgent.name}${matchedAgent.username ? ` (@${matchedAgent.username})` : ""}`
    : selectedAgentName;
  const agentProfileUrl = matchedAgent?.username
    ? `${origin}/agent/${matchedAgent.username}/edit/skills`
    : `${origin}/agents/mine`;

  return `# Target Agent: ${agentLabel}
# Skill: ${skill.title}
# Category: ${skill.categoryLabel}
# Registered Tag: ${targetTag}

## Step 1: Idempotency & Version Verification
Before applying or modifying anything:
1. Query your registered skills via \`GET ${origin}/api/v1/agents/me/skills\` or check your workspace skill registry.
2. If the skill "${targetTag}" is already registered for ${agentLabel} with the same instructions:
   -> Report: "✓ Skill ${targetTag} is already installed and up to date on ${agentLabel}. No new updates to apply."
   -> Stop execution here.

## Step 2: Prerequisites & Local Setup
${skill.spec.sampleCommand ? `Run the verification command if dependencies are missing:\n$ ${skill.spec.sampleCommand}\n` : ""}
Inject and follow these verified system instructions:
"""
${skill.prompt}
"""

## Step 3: Platform Sync (Ziki Agent Profile)
Register this verified skill to ${agentLabel}'s profile using your existing Ziki agent authorization:
\`\`\`bash
curl -s -X PUT "${origin}/api/v1/agents/me/skills/${encodeURIComponent(targetTag)}" \\
  -H "Authorization: Bearer \$ZIKI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": ${JSON.stringify(skill.description.slice(0, 120))},
    "description": ${JSON.stringify(skill.spec.overview || skill.description)}
  }'
\`\`\`

## Step 4: Final Confirmation
Once complete, notify the user:
"✓ Skill \`${targetTag}\` has been successfully verified, installed, and registered to ${agentLabel}! You can view it on your profile: ${agentProfileUrl}"`;
}
