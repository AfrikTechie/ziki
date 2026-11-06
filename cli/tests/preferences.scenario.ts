import { beforeAll, describe, expect, it } from "vitest";
import { ok, refused, ziki, type Agent } from "./helpers";

type Preference = { id: string; content: string };

/**
 * Per-user agent preferences (#838): ada's standing instructions belong to her
 * key's owner, so she adds one, reads it back, changes its text and drops it; a
 * blank or over-long one is refused without being stored; and bob's owner's
 * list never contains hers — the rows are per person, not per agent, and
 * nobody else's id is reachable at all.
 *
 * The sandbox gives each agent its own owner (cli/setup.ts), so this is the
 * cross-person half of the rule; the "every key one owner has reads the same
 * set" half is unit-tested, since no two sandbox agents share a person.
 */
describe("agent preferences", () => {
  const run = Date.now().toString(36);
  const instruction = `Always run pnpm verify:ready before a PR (${run}).`;
  const edited = `Run the tests and pnpm build too (${run}).`;

  /** A previous run that stopped halfway leaves rows behind; the list starts empty. */
  async function clear(agent: Agent): Promise<void> {
    const list = (await ok(agent, "list-preferences")) as { preferences: Preference[] };
    for (const preference of list.preferences) await ok(agent, "delete-preference", { id: preference.id });
  }

  beforeAll(async () => {
    await clear("ada");
    await clear("bob");
  });

  it("adds an instruction, lists it, edits it and deletes it", async () => {
    const added = (await ok("ada", "add-preference", { content: instruction })) as { preference: Preference };
    expect(added.preference.content).toBe(instruction);

    let list = (await ok("ada", "list-preferences")) as { preferences: Preference[] };
    expect(list.preferences.map((preference) => preference.content)).toContain(instruction);

    const id = added.preference.id;
    const saved = (await ok("ada", "update-preference", { id, content: edited })) as { preference: Preference };
    expect(saved.preference).toMatchObject({ id, content: edited });

    list = (await ok("ada", "list-preferences")) as { preferences: Preference[] };
    expect(list.preferences.find((preference) => preference.id === id)?.content).toBe(edited);
    expect(list.preferences.map((preference) => preference.content)).not.toContain(instruction);

    await ok("ada", "delete-preference", { id });
    list = (await ok("ada", "list-preferences")) as { preferences: Preference[] };
    expect(list.preferences.find((preference) => preference.id === id)).toBeUndefined();

    // Deleting it twice is the same 404 as deleting one that never existed.
    await refused("ada", "delete-preference", { id }, 404);
  });

  it("refuses a blank instruction and one over the limit, storing neither", async () => {
    // The command checks the same schema the route does, so a bad instruction
    // never leaves the terminal: a usage error (exit 2), not an API refusal.
    const blank = await ziki("add-preference", "--content", "   ", "--as", "ada");
    expect(blank.code).toBe(2);
    expect(blank.err).toMatch(/--content/);

    const tooLong = await ziki("add-preference", "--content", "x".repeat(4001), "--as", "ada");
    expect(tooLong.code).toBe(2);
    expect(tooLong.err).toMatch(/--content/);

    // Going past the command to the route itself, the answer is 422 either way.
    const refusedBlank = await ziki(
      "request", "POST", "/agents/me/preferences",
      "--body", JSON.stringify({ content: "   " }), "--as", "ada",
    );
    expect(refusedBlank.code).toBe(1);
    expect(refusedBlank.json?.status).toBe(422);

    const refusedLong = await ziki(
      "request", "POST", "/agents/me/preferences",
      "--body", JSON.stringify({ content: "x".repeat(4001) }), "--as", "ada",
    );
    expect(refusedLong.code).toBe(1);
    expect(refusedLong.json?.status).toBe(422);

    const list = (await ok("ada", "list-preferences")) as { preferences: Preference[] };
    expect(list.preferences.some((preference) => !preference.content.trim())).toBe(false);
    expect(list.preferences.some((preference) => preference.content.length > 4000)).toBe(false);
  });

  it("keeps one owner's instructions out of another owner's", async () => {
    const added = (await ok("ada", "add-preference", { content: `Ada's own rule (${run}).` })) as { preference: Preference };

    const bobList = (await ok("bob", "list-preferences")) as { preferences: Preference[] };
    expect(bobList.preferences.map((preference) => preference.id)).not.toContain(added.preference.id);

    // Bob can neither change nor delete it: 404, which reads the same as absent.
    await refused("bob", "update-preference", { id: added.preference.id, content: "Bob's rule." }, 404);
    await refused("bob", "delete-preference", { id: added.preference.id }, 404);

    const adaList = (await ok("ada", "list-preferences")) as { preferences: Preference[] };
    expect(adaList.preferences.map((preference) => preference.id)).toContain(added.preference.id);
    expect(adaList.preferences.find((preference) => preference.id === added.preference.id)?.content).toBe(
      `Ada's own rule (${run}).`,
    );

    await ok("ada", "delete-preference", { id: added.preference.id });
  });
});
