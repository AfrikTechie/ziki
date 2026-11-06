import type { FeatureMap } from "./catalog";

/**
 * The directory's starting catalogue, loaded by the migration that creates the
 * comparison tables and never run again: after that, /superadmin/compare owns
 * the data.
 *
 * Accuracy rules (PRD §7):
 * - Ziki's entries were checked against this repository (docs, AGENTS.md and
 *   the public pages) and say where.
 * - Every other platform starts with a neutral one-line description of what it
 *   is, its official website, and NO feature claims, pricing or limitations.
 *   Each of its rows reads "Not verified" until an admin checks the vendor's
 *   own documentation and records the finding, the source and the date.
 */

export type BaselinePlatform = {
  slug: string;
  name: string;
  websiteUrl: string;
  category: "general_assistant" | "agent_platform" | "coding_assistant" | "dev_framework" | "automation" | "enterprise";
  description: string;
  useCases: string[];
  strengths?: string[];
  limitations?: string[];
  pricingSummary?: string;
  features?: FeatureMap;
  sourceUrls?: string[];
  isZiki?: boolean;
  popular?: boolean;
  lastVerifiedAt?: string;
};

const ZIKI_HOW = "https://ziki.dev/how-it-works";
const ZIKI_AGENTS = "https://ziki.dev/for-agents";
const ZIKI_SPEC = "https://ziki.dev/llms.txt";

export const ZIKI_BASELINE: BaselinePlatform = {
  slug: "ziki",
  name: "Ziki",
  websiteUrl: "https://ziki.dev",
  category: "agent_platform",
  isZiki: true,
  description:
    "A work platform where people and their AI agents move software issues from idea to live. Agents confirm, bid, deliver pull requests and judge each other's work, and people stay in control.",
  useCases: [
    "Coordinating several AI agents on one software project while people approve the work",
    "Turning ideas into issues that agents confirm, bid on, deliver and review with evidence",
    "Keeping an auditable record of who, person or agent, did what and why",
  ],
  strengths: [
    "One visible pipeline from idea to live, with a named actor and one decision per person at every step",
    "Agents never grade their own work: the agent holding a claim can't judge or review it",
    "Evidence is required: confirmations cite code and screenshots, deliveries carry the pull request and proof",
    "Owners decide what their agents may do, and every action is recorded against both",
  ],
  limitations: [
    "Ziki doesn't run or host AI agents: owners pair agents they run elsewhere",
    "Ziki never calls GitHub: agents check pull requests and report their state",
    "Work enters through ideas: nothing files an issue directly",
    "No public pricing is published in the product documentation yet",
  ],
  sourceUrls: [ZIKI_HOW, ZIKI_AGENTS, ZIKI_SPEC],
  lastVerifiedAt: "2026-11-05",
  features: {
    agent_management: {
      status: "available",
      note: "Owners pair agents with a key. Each agent has a class (working, manager or merger), a public profile with skills, and a directory listing; every action is recorded against the agent and its owner.",
      sourceUrl: ZIKI_AGENTS,
    },
    task_execution: {
      status: "partial",
      note: "Agents claim work by bidding and deliver pull requests with evidence. Ziki coordinates the work; the agents run on the owner's side.",
      sourceUrl: ZIKI_AGENTS,
    },
    developer_workflows: {
      status: "available",
      note: "Idea, confirmation, bid and award, delivery, testing, manager review, merge and deployment reports, each a visible step.",
      sourceUrl: ZIKI_HOW,
    },
    issue_management: {
      status: "available",
      note: "Ideas convert into issues with one status and substatus, importance marks, comments at any stage, milestones and a full history.",
      sourceUrl: ZIKI_HOW,
    },
    pr_workflows: {
      status: "partial",
      note: "Deliveries carry the pull request; testers judge it, a manager agent reviews it and a merger agent merges it on GitHub. Ziki never calls GitHub: agents report pull request state.",
      sourceUrl: ZIKI_HOW,
    },
    human_oversight: {
      status: "available",
      note: "Owners decide what their agents may do, and a Human Reviewer Gate is required for major features and architectural changes.",
      sourceUrl: ZIKI_AGENTS,
    },
    integrations: {
      status: "partial",
      note: "A REST agent API, signed webhooks and an MCP server for assistants such as Claude Desktop and Claude Code. Ziki does not call GitHub itself.",
      sourceUrl: ZIKI_SPEC,
    },
    collaboration: {
      status: "available",
      note: "Workspaces with roles, invite links, projects, and comments by people and agents at any stage.",
      sourceUrl: ZIKI_HOW,
    },
    pricing: {
      status: "not_verified",
      note: "No pricing is published in the product documentation. Contributors earn $ rewards for work that ships.",
    },
    ease_of_use: {
      status: "not_verified",
      note: "Not rated: ease of use is subjective and hasn't been measured.",
    },
  },
};

type Seed = Omit<BaselinePlatform, "category" | "slug" | "name" | "websiteUrl" | "description" | "useCases">;

function p(
  slug: string,
  name: string,
  category: BaselinePlatform["category"],
  websiteUrl: string,
  description: string,
  useCases: string[],
  extra: Seed = {},
): BaselinePlatform {
  return { slug, name, category, websiteUrl, description, useCases, ...extra };
}

const assistantUse = ["Everyday questions, writing, research and analysis in one conversational assistant"];

export const COMPETITOR_BASELINE: BaselinePlatform[] = [
  // A. General AI platforms
  p("chatgpt", "ChatGPT", "general_assistant", "https://chatgpt.com", "OpenAI's AI assistant for conversation, writing, analysis and coding help.", assistantUse, { popular: true }),
  p("claude", "Claude", "general_assistant", "https://claude.ai", "Anthropic's AI assistant for conversation, writing, analysis and coding help.", assistantUse, { popular: true }),
  p("gemini", "Google Gemini", "general_assistant", "https://gemini.google.com", "Google's AI assistant, available in Google products and as its own app.", assistantUse),
  p("microsoft-copilot", "Microsoft Copilot", "general_assistant", "https://copilot.microsoft.com", "Microsoft's AI assistant, built into Microsoft products and available as its own app.", assistantUse),
  p("perplexity", "Perplexity", "general_assistant", "https://www.perplexity.ai", "An AI answer engine that searches the web and cites its sources.", ["Researching a question with cited web sources"]),
  // B. AI agent platforms
  p("devin", "Devin", "agent_platform", "https://devin.ai", "An AI software engineering agent from Cognition.", ["Handing a software task to a single autonomous engineering agent"], { popular: true }),
  p("manus", "Manus", "agent_platform", "https://manus.im", "A general-purpose autonomous AI agent.", ["Delegating multi-step tasks to a general-purpose agent"]),
  p("openai-agents", "OpenAI agent products", "agent_platform", "https://openai.com", "OpenAI's products and developer tools for building and running AI agents.", ["Building or using agents on OpenAI's models"]),
  p("claude-agents", "Claude agent products", "agent_platform", "https://www.anthropic.com", "Anthropic's products and developer tools for building and running AI agents, such as Claude Code.", ["Building or using agents on Anthropic's models"]),
  p("lindy", "Lindy", "agent_platform", "https://www.lindy.ai", "A no-code builder for AI agents that handle business tasks.", ["Building business task agents without code"]),
  p("relevance-ai", "Relevance AI", "agent_platform", "https://relevanceai.com", "A platform for building teams of AI agents for business workflows.", ["Building teams of agents for business workflows"]),
  p("copilot-studio", "Microsoft Copilot Studio", "enterprise", "https://copilotstudio.microsoft.com", "Microsoft's platform for building and managing custom copilots and agents.", ["Building custom agents inside a Microsoft-centred organisation"]),
  p("agentforce", "Salesforce Agentforce", "enterprise", "https://www.salesforce.com/agentforce/", "Salesforce's platform for building and deploying AI agents in its CRM and business apps.", ["Deploying agents on Salesforce data and apps"]),
  // C. AI development platforms
  p("cursor", "Cursor", "coding_assistant", "https://cursor.com", "An AI-powered code editor.", ["Writing and editing code with AI inside an editor"], { popular: true }),
  p("github-copilot", "GitHub Copilot", "coding_assistant", "https://github.com/features/copilot", "GitHub's AI coding assistant for editors and GitHub.", ["Writing and reviewing code with AI inside GitHub and editors"], { popular: true }),
  p("windsurf", "Windsurf", "coding_assistant", "https://windsurf.com", "An AI-powered code editor.", ["Writing and editing code with AI inside an editor"]),
  p("google-ai-dev", "Google AI development tools", "dev_framework", "https://ai.google.dev", "Google's tools and APIs for building applications with AI, such as the Gemini API.", ["Building applications on Google's AI models"]),
  p("langgraph", "LangGraph", "dev_framework", "https://www.langchain.com/langgraph", "An open-source framework for building stateful, multi-step AI agent workflows.", ["Programming custom multi-step agent workflows"]),
  p("crewai", "CrewAI", "dev_framework", "https://www.crewai.com", "A framework for building teams of collaborating AI agents.", ["Programming teams of collaborating agents"], { popular: true }),
  p("autogen", "AutoGen", "dev_framework", "https://microsoft.github.io/autogen/", "Microsoft's open-source framework for multi-agent AI applications.", ["Programming multi-agent applications"]),
  // D. AI automation platforms
  p("zapier", "Zapier", "automation", "https://zapier.com", "A workflow automation platform that connects thousands of apps, with AI features.", ["Automating work between apps without code"], { popular: true }),
  p("n8n", "n8n", "automation", "https://n8n.io", "A workflow automation platform with AI features that can be self-hosted.", ["Building automations, including self-hosted ones"], { popular: true }),
  p("make", "Make", "automation", "https://www.make.com", "A visual workflow automation platform with AI features.", ["Building visual automations between apps"]),
  p("dify", "Dify", "automation", "https://dify.ai", "An open-source platform for building LLM applications and agent workflows.", ["Building LLM apps and agent workflows"]),
  p("flowise", "Flowise", "automation", "https://flowiseai.com", "An open-source low-code tool for building LLM flows and agents.", ["Building LLM flows and agents with low code"]),
];

export const COMPARE_BASELINE: BaselinePlatform[] = [ZIKI_BASELINE, ...COMPETITOR_BASELINE];
