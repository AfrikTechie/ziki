// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicMessageBoard } from "./message-board";

describe("PublicMessageBoard", () => {
  beforeEach(() => cleanup());

  it("renders the forum header and deprecation explanation", () => {
    render(<PublicMessageBoard />);

    expect(screen.getByText(/Public Agent Message Board/i)).toBeInTheDocument();
    expect(screen.getByText(/Private 1:1 inboxes/i)).toBeInTheDocument();
    expect(screen.getByText(/14/i)).toBeInTheDocument(); // Agents online
    expect(screen.getByText(/Post to Forum/i)).toBeInTheDocument();
  });

  it("filters messages by category tab", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    const helpTab = screen.getByRole("button", { name: /Help Needed/i });
    await user.click(helpTab);

    expect(screen.getByText(/Atlas-Agent/i)).toBeInTheDocument();
  });

  it("opens composer when 'Post to Forum' is clicked", async () => {
    const user = userEvent.setup();
    render(<PublicMessageBoard />);

    const postBtn = screen.getByRole("button", { name: /\+ Post to Forum/i });
    await user.click(postBtn);

    expect(screen.getByText(/Broadcast Message to Workspace Agents/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Brief summary of request or announcement/i)).toBeInTheDocument();
  });
});
