import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockResolveSessionUserId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-user", () => ({
  resolveSessionUserId: mockResolveSessionUserId,
}));

const mockRequireAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/require-agent", () => ({
  requireAgent: mockRequireAgent,
}));

const mockFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
  },
}));

import { GET, POST } from "./route";

function createMockRequest(
  url: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>
) {
  const fullUrl = url.startsWith("http") ? url : `http://localhost:3000${url}`;
  return new NextRequest(fullUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/v1/forum API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionUserId.mockResolvedValue({ userId: "user-1" });
    mockFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Ezekiel",
      email: "ezekiel@example.com",
      role: "admin",
    });
    mockRequireAgent.mockResolvedValue({
      agentId: "agent-123456",
      name: "Atlas-Agent",
      ownerId: "user-1",
      tenantId: "tenant-1",
      level: "working",
      burst: false,
      keyId: "key-1",
    });
  });

  describe("GET /api/v1/forum", () => {
    it("returns forum messages list and count", async () => {
      const req = createMockRequest("/api/v1/forum");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.count).toBeGreaterThanOrEqual(1);
    });

    it("filters messages by category", async () => {
      const req = createMockRequest("/api/v1/forum?category=help_needed");
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      for (const msg of json.messages) {
        expect(msg.category).toBe("help_needed");
      }
    });
  });

  describe("POST /api/v1/forum", () => {
    it("rejects unauthorized requests when neither user session nor agent key is present", async () => {
      mockResolveSessionUserId.mockResolvedValueOnce({ error: "unauthorized" });

      const req = createMockRequest("/api/v1/forum", "POST", {
        title: "Test",
        content: "Test message",
        category: "announcement",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("validates required fields and rejects invalid schema", async () => {
      const req = createMockRequest("/api/v1/forum", "POST", {
        title: "", // empty title
        content: "Some content",
        category: "help_needed",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("creates a new forum message successfully when user is authenticated", async () => {
      const payload = {
        title: "Urgent help needed on #1042",
        content: "Need assistance simulating concurrent webhook payload.",
        category: "help_needed",
        issueNumber: 1042,
      };

      const req = createMockRequest("/api/v1/forum", "POST", payload);
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.message.title).toBe(payload.title);
      expect(json.message.issueNumber).toBe(1042);
      expect(json.message.author.name).toBe("Ezekiel");
    });

    it("creates a forum message on behalf of an authenticated agent via Authorization header", async () => {
      mockRequireAgent.mockResolvedValueOnce({
        agentId: "agent-atlas-123",
        name: "Atlas-Agent",
        agentName: "Atlas-Agent",
      });

      const payload = {
        title: "Architecture question on state machine",
        content: "Reviewing race condition on #419",
        category: "review_request",
      };

      const req = createMockRequest(
        "/api/v1/forum",
        "POST",
        payload,
        { authorization: "Bearer ziki_agent_token" }
      );

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.message.author.isAgent).toBe(true);
      expect(json.message.author.name).toBe("Atlas-Agent");
    });
  });
});
