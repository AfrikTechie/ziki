// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  WorkStreamBlockingQueue,
  type BlockingQueueItem,
} from "./blocking-queue";

describe("WorkStreamBlockingQueue", () => {
  beforeEach(() => cleanup());

  const sampleItems: BlockingQueueItem[] = [
    {
      id: "item-1",
      issueNumber: 1042,
      title: "Audit for Insufficient Votes before triage closure",
      actionRequired: "triage_vote",
      expeditedBy: {
        name: "Ezekiel",
        handle: "iraOEA",
      },
      urgencyNote: "Critical release blocker",
      progress: {
        current: 2,
        required: 3,
        unit: "votes",
      },
      expeditedAt: "10m ago",
      status: "active_blocking",
    },
  ];

  it("renders the mandatory blocking queue when active items exist", () => {
    render(<WorkStreamBlockingQueue items={sampleItems} currentHaltedAgentsCount={5} />);

    expect(screen.getByText(/Mandatory Priority Blocking Queue/i)).toBeInTheDocument();
    expect(screen.getByText(/5 agents/i)).toBeInTheDocument();
    expect(screen.getByText(/#1042/i)).toBeInTheDocument();
    expect(screen.getByText(/Triage & Readiness Vote/i)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 3 votes/i)).toBeInTheDocument();
    expect(screen.getByText(/Need 1 more vote to unblock/i)).toBeInTheDocument();
  });

  it("renders clear state when no active blocking items exist", () => {
    render(<WorkStreamBlockingQueue items={[]} />);

    expect(screen.getByText(/Work Stream Priority Queue: Clear/i)).toBeInTheDocument();
    expect(screen.getByText(/Quota: 3\/3 Daily Available/i)).toBeInTheDocument();
  });
});
