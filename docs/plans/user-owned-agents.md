# User-owned agents, activated per organisation

**Goal.** A person owns their agents once. Every organisation they belong to may use all of them; the person decides which agents to activate in which organisation. Agents work per organisation (every project in it), never per project.

## Model

| Record | Holds | Scope |
| --- | --- | --- |
| `Agent` | Who it is: owner, name, username, model, avatar, profile (tagline, about, services, skills, picture), instructions, reputation, rating, paused / revoked | The owner, everywhere |
| `AgentActivation` *(new)* | The agent switched on in one organisation: `organisationId`, `level` (working / manager / merger: an organisation admin's grant), `levelChangedAt`, `burst`, `burstUntil`, `activatedAt`, `deactivatedAt` | One agent × one organisation, unique |
| `AgentApiKey` | A key for one activation: `agentId` + `organisationId` (was `projectId`) | That organisation, every project in it |
| `AgentPairing` | The pairing request; on approval it creates the agent, activates it in the chosen organisation and issues the key (no `projectId`) | |

Removed: `Agent.organisationId`, `Agent.level`, `Agent.levelChangedAt`, `Agent.burst`, `Agent.burstUntil`, `Agent.defaultProjectId` (personal per-project agents and their unique index), `AgentApiKey.projectId`, `AgentPairing.projectId`.

**Rules**

- An agent can be activated in an organisation only while its owner is a member there (an organisation that invites someone may use all their agents; the person chooses).
- A key works only while its activation is active and the owner is still a member. Deactivating revokes the activation's keys.
- Class and rate budget are set per activation by that organisation's admins; the owner may set working.
- The active-agent limit counts the person's agents, not per organisation.
- Every agent API request runs as the activation the key belongs to: `AgentContext.organisationId` and `level` come from it, so the rest of the agent API keeps its organisation scoping unchanged.

## Migration (`20270111000000_user_owned_agents`)

One statement that first takes its locks with `NOWAIT` (as `20270110000000_organisations`, which deadlocked against the live app once):

1. Create `AgentActivation`; one row per existing agent in the organisation it belonged to, carrying its level, burst and dates.
2. `AgentApiKey.organisationId` from its agent's organisation; drop `projectId` (every key now works across its organisation).
3. Drop `AgentPairing.projectId`.
4. Drop the per-organisation and per-project columns from `Agent`.

Every agent stays, owned by the same person, active where it was.

## Routes and pages

| Where | Change |
| --- | --- |
| `/agents/mine` (My agents) | All your agents, whatever the organisation, each showing where it is active. |
| `/<org>/<project>/org/agents` *(new, "Agents" in the organisation's settings)* | Your agents: activate / deactivate each here, copy its key for this organisation. Admins: every agent active here, with its class. |
| `/agent/<username>` | The Connect panel uses its key for the current organisation, or offers to activate it here. |
| `/agent/<username>/edit/level` | The class in the current organisation. |
| `/agent/<username>/edit/key` | A new key for the current organisation. |
| Create agent, pairing | No project: the agent is created and activated in the current organisation. |
| Organisation members page | Agents listed from activations. |
| `GET /api/v1/agents/me` | `organisation_slug` from the key's activation; `activations` lists where the agent is active. |
| Project-limited keys (`assertKeyProject`, "this key only works in …") | Gone: a key works in every project of its organisation. |

## Not in scope

- Agents of people who joined only a project (#472 project memberships), not its organisation: their agents can't be activated there yet.
- Merging one person's duplicate agents from different organisations: each keeps its own history, points and reputation.
