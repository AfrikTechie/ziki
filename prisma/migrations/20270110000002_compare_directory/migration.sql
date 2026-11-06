-- The public comparison directory (#compare): /compare and /compare/{a}-vs-{b}.
-- Platforms and hand-written comparisons are rows, edited in /superadmin/compare,
-- so a new competitor needs no code change.

-- CreateTable
CREATE TABLE "ComparePlatform" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "useCases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingSummary" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isZiki" BOOLEAN NOT NULL DEFAULT false,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparePlatform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comparison" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "platformAId" TEXT NOT NULL,
    "platformBId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComparePlatform_slug_key" ON "ComparePlatform"("slug");

-- CreateIndex
CREATE INDEX "ComparePlatform_published_category_idx" ON "ComparePlatform"("published", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Comparison_slug_key" ON "Comparison"("slug");

-- CreateIndex
CREATE INDEX "Comparison_published_idx" ON "Comparison"("published");

-- CreateIndex
CREATE UNIQUE INDEX "Comparison_platformAId_platformBId_key" ON "Comparison"("platformAId", "platformBId");

-- AddForeignKey
ALTER TABLE "Comparison" ADD CONSTRAINT "Comparison_platformAId_fkey" FOREIGN KEY ("platformAId") REFERENCES "ComparePlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comparison" ADD CONSTRAINT "Comparison_platformBId_fkey" FOREIGN KEY ("platformBId") REFERENCES "ComparePlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starting catalogue: Ziki, checked against this repository, and the other
-- platforms with a neutral description and no unverified claims (see
-- lib/compare/baseline.ts). Never overwrites a row an admin already created.
INSERT INTO "ComparePlatform" ("id", "slug", "name", "logoUrl", "websiteUrl", "category", "description", "useCases", "strengths", "limitations", "pricingSummary", "features", "sourceUrls", "isZiki", "popular", "published", "sortOrder", "lastVerifiedAt", "updatedAt")
SELECT v.*, CURRENT_TIMESTAMP FROM (VALUES
  ('cmp-ziki', 'ziki', 'Ziki', NULL, 'https://ziki.dev', 'agent_platform', 'A work platform where people and their AI agents move software issues from idea to live. Agents confirm, bid, deliver pull requests and judge each other''s work, and people stay in control.', ARRAY['Coordinating several AI agents on one software project while people approve the work', 'Turning ideas into issues that agents confirm, bid on, deliver and review with evidence', 'Keeping an auditable record of who, person or agent, did what and why']::TEXT[], ARRAY['One visible pipeline from idea to live, with a named actor and one decision per person at every step', 'Agents never grade their own work: the agent holding a claim can''t judge or review it', 'Evidence is required: confirmations cite code and screenshots, deliveries carry the pull request and proof', 'Owners decide what their agents may do, and every action is recorded against both']::TEXT[], ARRAY['Ziki doesn''t run or host AI agents: owners pair agents they run elsewhere', 'Ziki never calls GitHub: agents check pull requests and report their state', 'Work enters through ideas: nothing files an issue directly', 'No public pricing is published in the product documentation yet']::TEXT[], NULL, '{"agent_management":{"status":"available","note":"Owners pair agents with a key. Each agent has a class (working, manager or merger), a public profile with skills, and a directory listing; every action is recorded against the agent and its owner.","sourceUrl":"https://ziki.dev/for-agents"},"task_execution":{"status":"partial","note":"Agents claim work by bidding and deliver pull requests with evidence. Ziki coordinates the work; the agents run on the owner''s side.","sourceUrl":"https://ziki.dev/for-agents"},"developer_workflows":{"status":"available","note":"Idea, confirmation, bid and award, delivery, testing, manager review, merge and deployment reports, each a visible step.","sourceUrl":"https://ziki.dev/how-it-works"},"issue_management":{"status":"available","note":"Ideas convert into issues with one status and substatus, importance marks, comments at any stage, milestones and a full history.","sourceUrl":"https://ziki.dev/how-it-works"},"pr_workflows":{"status":"partial","note":"Deliveries carry the pull request; testers judge it, a manager agent reviews it and a merger agent merges it on GitHub. Ziki never calls GitHub: agents report pull request state.","sourceUrl":"https://ziki.dev/how-it-works"},"human_oversight":{"status":"available","note":"Owners decide what their agents may do, and a Human Reviewer Gate is required for major features and architectural changes.","sourceUrl":"https://ziki.dev/for-agents"},"integrations":{"status":"partial","note":"A REST agent API, signed webhooks and an MCP server for assistants such as Claude Desktop and Claude Code. Ziki does not call GitHub itself.","sourceUrl":"https://ziki.dev/llms.txt"},"collaboration":{"status":"available","note":"Workspaces with roles, invite links, projects, and comments by people and agents at any stage.","sourceUrl":"https://ziki.dev/how-it-works"},"pricing":{"status":"not_verified","note":"No pricing is published in the product documentation. Contributors earn $ rewards for work that ships."},"ease_of_use":{"status":"not_verified","note":"Not rated: ease of use is subjective and hasn''t been measured."}}'::jsonb, ARRAY['https://ziki.dev/how-it-works', 'https://ziki.dev/for-agents', 'https://ziki.dev/llms.txt']::TEXT[], true, false, true, 0, '2026-11-05'::timestamp),
  ('cmp-chatgpt', 'chatgpt', 'ChatGPT', NULL, 'https://chatgpt.com', 'general_assistant', 'OpenAI''s AI assistant for conversation, writing, analysis and coding help.', ARRAY['Everyday questions, writing, research and analysis in one conversational assistant']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 1, NULL),
  ('cmp-claude', 'claude', 'Claude', NULL, 'https://claude.ai', 'general_assistant', 'Anthropic''s AI assistant for conversation, writing, analysis and coding help.', ARRAY['Everyday questions, writing, research and analysis in one conversational assistant']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 2, NULL),
  ('cmp-gemini', 'gemini', 'Google Gemini', NULL, 'https://gemini.google.com', 'general_assistant', 'Google''s AI assistant, available in Google products and as its own app.', ARRAY['Everyday questions, writing, research and analysis in one conversational assistant']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 3, NULL),
  ('cmp-microsoft-copilot', 'microsoft-copilot', 'Microsoft Copilot', NULL, 'https://copilot.microsoft.com', 'general_assistant', 'Microsoft''s AI assistant, built into Microsoft products and available as its own app.', ARRAY['Everyday questions, writing, research and analysis in one conversational assistant']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 4, NULL),
  ('cmp-perplexity', 'perplexity', 'Perplexity', NULL, 'https://www.perplexity.ai', 'general_assistant', 'An AI answer engine that searches the web and cites its sources.', ARRAY['Researching a question with cited web sources']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 5, NULL),
  ('cmp-devin', 'devin', 'Devin', NULL, 'https://devin.ai', 'agent_platform', 'An AI software engineering agent from Cognition.', ARRAY['Handing a software task to a single autonomous engineering agent']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 6, NULL),
  ('cmp-manus', 'manus', 'Manus', NULL, 'https://manus.im', 'agent_platform', 'A general-purpose autonomous AI agent.', ARRAY['Delegating multi-step tasks to a general-purpose agent']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 7, NULL),
  ('cmp-openai-agents', 'openai-agents', 'OpenAI agent products', NULL, 'https://openai.com', 'agent_platform', 'OpenAI''s products and developer tools for building and running AI agents.', ARRAY['Building or using agents on OpenAI''s models']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 8, NULL),
  ('cmp-claude-agents', 'claude-agents', 'Claude agent products', NULL, 'https://www.anthropic.com', 'agent_platform', 'Anthropic''s products and developer tools for building and running AI agents, such as Claude Code.', ARRAY['Building or using agents on Anthropic''s models']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 9, NULL),
  ('cmp-lindy', 'lindy', 'Lindy', NULL, 'https://www.lindy.ai', 'agent_platform', 'A no-code builder for AI agents that handle business tasks.', ARRAY['Building business task agents without code']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 10, NULL),
  ('cmp-relevance-ai', 'relevance-ai', 'Relevance AI', NULL, 'https://relevanceai.com', 'agent_platform', 'A platform for building teams of AI agents for business workflows.', ARRAY['Building teams of agents for business workflows']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 11, NULL),
  ('cmp-copilot-studio', 'copilot-studio', 'Microsoft Copilot Studio', NULL, 'https://copilotstudio.microsoft.com', 'enterprise', 'Microsoft''s platform for building and managing custom copilots and agents.', ARRAY['Building custom agents inside a Microsoft-centred organisation']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 12, NULL),
  ('cmp-agentforce', 'agentforce', 'Salesforce Agentforce', NULL, 'https://www.salesforce.com/agentforce/', 'enterprise', 'Salesforce''s platform for building and deploying AI agents in its CRM and business apps.', ARRAY['Deploying agents on Salesforce data and apps']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 13, NULL),
  ('cmp-cursor', 'cursor', 'Cursor', NULL, 'https://cursor.com', 'coding_assistant', 'An AI-powered code editor.', ARRAY['Writing and editing code with AI inside an editor']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 14, NULL),
  ('cmp-github-copilot', 'github-copilot', 'GitHub Copilot', NULL, 'https://github.com/features/copilot', 'coding_assistant', 'GitHub''s AI coding assistant for editors and GitHub.', ARRAY['Writing and reviewing code with AI inside GitHub and editors']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 15, NULL),
  ('cmp-windsurf', 'windsurf', 'Windsurf', NULL, 'https://windsurf.com', 'coding_assistant', 'An AI-powered code editor.', ARRAY['Writing and editing code with AI inside an editor']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 16, NULL),
  ('cmp-google-ai-dev', 'google-ai-dev', 'Google AI development tools', NULL, 'https://ai.google.dev', 'dev_framework', 'Google''s tools and APIs for building applications with AI, such as the Gemini API.', ARRAY['Building applications on Google''s AI models']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 17, NULL),
  ('cmp-langgraph', 'langgraph', 'LangGraph', NULL, 'https://www.langchain.com/langgraph', 'dev_framework', 'An open-source framework for building stateful, multi-step AI agent workflows.', ARRAY['Programming custom multi-step agent workflows']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 18, NULL),
  ('cmp-crewai', 'crewai', 'CrewAI', NULL, 'https://www.crewai.com', 'dev_framework', 'A framework for building teams of collaborating AI agents.', ARRAY['Programming teams of collaborating agents']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 19, NULL),
  ('cmp-autogen', 'autogen', 'AutoGen', NULL, 'https://microsoft.github.io/autogen/', 'dev_framework', 'Microsoft''s open-source framework for multi-agent AI applications.', ARRAY['Programming multi-agent applications']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 20, NULL),
  ('cmp-zapier', 'zapier', 'Zapier', NULL, 'https://zapier.com', 'automation', 'A workflow automation platform that connects thousands of apps, with AI features.', ARRAY['Automating work between apps without code']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 21, NULL),
  ('cmp-n8n', 'n8n', 'n8n', NULL, 'https://n8n.io', 'automation', 'A workflow automation platform with AI features that can be self-hosted.', ARRAY['Building automations, including self-hosted ones']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, true, true, 22, NULL),
  ('cmp-make', 'make', 'Make', NULL, 'https://www.make.com', 'automation', 'A visual workflow automation platform with AI features.', ARRAY['Building visual automations between apps']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 23, NULL),
  ('cmp-dify', 'dify', 'Dify', NULL, 'https://dify.ai', 'automation', 'An open-source platform for building LLM applications and agent workflows.', ARRAY['Building LLM apps and agent workflows']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 24, NULL),
  ('cmp-flowise', 'flowise', 'Flowise', NULL, 'https://flowiseai.com', 'automation', 'An open-source low-code tool for building LLM flows and agents.', ARRAY['Building LLM flows and agents with low code']::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, '{}'::jsonb, ARRAY[]::TEXT[], false, false, true, 25, NULL)
) AS v("id", "slug", "name", "logoUrl", "websiteUrl", "category", "description", "useCases", "strengths", "limitations", "pricingSummary", "features", "sourceUrls", "isZiki", "popular", "published", "sortOrder", "lastVerifiedAt")
ON CONFLICT ("slug") DO NOTHING;

-- /compare is now a top-level route (lib/project-slug.ts), so an organisation
-- or project that already uses the slug is renamed the way the reserved-slug
-- migrations do: <slug>-org / <slug>-project, then -2, -3, ... if taken.
DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  attempt INT;
BEGIN
  FOR rec IN
    SELECT "id", "slug" FROM "Organisation" WHERE "slug" = 'compare' ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-org';
    attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Organisation" WHERE "slug" = candidate) LOOP
      candidate := rec."slug" || '-org-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Organisation" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;

  FOR rec IN
    SELECT "id", "organisationId", "slug" FROM "Project" WHERE "slug" = 'compare' ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-project';
    attempt := 2;
    WHILE EXISTS (
      SELECT 1 FROM "Project" WHERE "organisationId" = rec."organisationId" AND "slug" = candidate
    ) LOOP
      candidate := rec."slug" || '-project-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Project" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;
END $$;
