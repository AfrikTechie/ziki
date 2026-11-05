import { describe, expect, it, vi } from "vitest";

/**
 * Marketing at a glance (/earn/home): each task's bar shows where it really
 * is, never a stand-in. A counted task (10 people, 10 emails) fills by what its
 * proof lists; a one-off task fills once.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { EARN_TASKS } from "@/lib/earn/draft";
import { proofCount, taskProgress, type EarnTaskRow } from "@/lib/earn/progress";

const [who, research, emails, post] = EARN_TASKS;
const row = (taskKey: string, status: EarnTaskRow["status"], proof: string | null = null): EarnTaskRow => ({ taskKey, status, note: null, proof });

describe("proofCount", () => {
  it("counts the filled lines of the research list, up to 10", () => {
    expect(proofCount(research, "Mama Ade's Bakery, Lagos, hello@mamaade.ng\n\n  \nCrust & Co, Ikeja\nBread Basket")).toBe(3);
    expect(proofCount(research, Array.from({ length: 14 }, (_, i) => `Shop ${i}`).join("\n"))).toBe(10);
  });

  it("counts distinct email addresses for the emails, however they are written", () => {
    expect(proofCount(emails, "a@x.ng, b@x.ng; A@x.ng\nc@y.com")).toBe(3);
    expect(proofCount(emails, "I sent them to the bakeries\nand the cake shops")).toBe(2);
  });

  it("counts a one-off task once, and nothing for an empty proof", () => {
    expect(proofCount(post, "https://x.com/me/status/1\nhttps://x.com/me/status/2")).toBe(1);
    expect(proofCount(who, "   ")).toBe(0);
    expect(proofCount(research, null)).toBe(0);
  });
});

describe("taskProgress", () => {
  it("shows nothing done for someone who has not started", () => {
    expect(taskProgress([]).map((item) => [item.state, item.done, item.target])).toEqual([
      ["open", 0, 1],
      ["open", 0, 10],
      ["open", 0, 10],
      ["open", 0, 1],
    ]);
  });

  it("fills paid tasks, counts the one in review, and leaves tasks not yet started empty", () => {
    const rows = [row("who", "confirmed", "Bakeries in Lagos"), row("research", "submitted", "One\nTwo\nThree\nFour")];
    expect(taskProgress(rows).map((item) => [item.state, item.done])).toEqual([
      ["paid", 1],
      ["in-review", 4],
      ["open", 0],
      ["open", 0],
    ]);
  });

  it("fills a task that was paid first, whichever it is, because every task is open", () => {
    const progress = taskProgress([row("post", "confirmed", "https://x.com/me/status/1")]);
    expect(progress.map((item) => [item.state, item.done])).toEqual([
      ["open", 0],
      ["open", 0],
      ["open", 0],
      ["paid", 1],
    ]);
  });

  it("counts nothing for a task that was only started or was sent back", () => {
    const started = taskProgress([row("who", "started")]);
    expect([started[0].state, started[0].done]).toEqual(["in-progress", 0]);
    const rejected = taskProgress([row("who", "confirmed"), row("research", "rejected", "One\nTwo")]);
    expect([rejected[1].state, rejected[1].done]).toEqual(["in-progress", 0]);
  });
});
