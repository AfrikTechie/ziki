"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import {
  addPreferenceAction,
  deletePreferenceAction,
  savePreferenceAction,
} from "@/app/actions/agent-preferences";
import {
  AGENT_PREFERENCE_CONTENT_MAX,
  AGENT_PREFERENCES_MAX,
} from "@/lib/validations/agent-preferences";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  AgentsSurface,
  agentsDangerBtn,
  agentsInputClass,
  agentsLabelClass,
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSecondaryBtn,
} from "@/app/(app)/settings/agents/agents-ui";

/** What the page hands down: the two fields the list draws. */
type Preference = { id: string; content: string };

const ADD_FORM_ID = "add-preference-form";
const EDIT_FORM_ID = "edit-preference-form";

/**
 * The instruction list for #838: add at the bottom, edit in place, delete after
 * confirming. The rows live in state rather than only in props so a save shows
 * up the moment it lands; the page still re-reads them from the database on
 * every navigation, so state and storage cannot drift apart for long.
 */
export function PreferencesPanel({ initial }: { initial: Preference[] }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<Preference[]>(initial);

  // Adding: one field, validated here so an empty instruction never leaves the
  // browser, and again by the server for anyone who isn't this form.
  const addFormRef = useRef<HTMLFormElement>(null);
  const addErrors = useFieldErrors(ADD_FORM_ID, addFormRef);
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();

  // Editing: at most one row at a time, with its own draft so Cancel can put
  // the original text back without touching the stored copy.
  const editFormRef = useRef<HTMLFormElement>(null);
  const editErrors = useFieldErrors(EDIT_FORM_ID, editFormRef);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savePending, startSave] = useTransition();

  const [deletePending, startDelete] = useTransition();

  const atCap = items.length >= AGENT_PREFERENCES_MAX;

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addErrors.clear();
    setAddError(null);

    const content = addText.trim();
    if (!content) {
      addErrors.show({ error: "Write an instruction.", field: "content", fieldErrors: { content: "Write an instruction." } });
      return;
    }

    startAdd(async () => {
      const result = await addPreferenceAction({ content });
      if (result.ok) {
        setAddText("");
        setItems((current) => [...current, { id: result.preference.id, content: result.preference.content }]);
        toast("Instruction added.", "success");
        return;
      }
      // A field-level refusal belongs under the box; a cap or a network failure
      // belongs where the form can be read as a whole.
      if (result.fieldErrors) addErrors.show(result);
      else setAddError(result.error);
    });
  }

  function beginEdit(preference: Preference) {
    editErrors.clear();
    setEditingId(preference.id);
    setDraft(preference.content);
  }

  function cancelEdit() {
    editErrors.clear();
    setEditingId(null);
    setDraft("");
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = editingId;
    if (!id) return;
    editErrors.clear();

    const content = draft.trim();
    if (!content) {
      editErrors.show({ error: "Write an instruction.", field: "content", fieldErrors: { content: "Write an instruction." } });
      return;
    }

    startSave(async () => {
      const result = await savePreferenceAction({ id, content });
      if (result.ok) {
        setItems((current) => current.map((item) => (item.id === id ? { id, content: result.preference.content } : item)));
        setEditingId(null);
        setDraft("");
        toast("Instruction saved.", "success");
        return;
      }
      if (result.fieldErrors) editErrors.show(result);
      else editErrors.show({ error: result.error });
    });
  }

  async function remove(preference: Preference) {
    const confirmed = await confirm({
      title: "Delete this instruction?",
      body: "Every agent you own stops following it. This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;

    startDelete(async () => {
      const result = await deletePreferenceAction({ id: preference.id });
      if (result.ok) {
        setItems((current) => current.filter((item) => item.id !== preference.id));
        // The row being edited may be the one that went.
        if (editingId === preference.id) cancelEdit();
        toast("Instruction deleted.", "success");
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <AgentsSurface as="section" aria-labelledby="preferences-heading" className="space-y-6">
      <div className="space-y-1">
        <h2 id="preferences-heading" className="text-base font-bold text-zk-text">
          Your instructions
        </h2>
        <p className={agentsMutedClass}>
          {items.length} of {AGENT_PREFERENCES_MAX} kept. Every agent you own follows all of them.
        </p>
      </div>

      {items.length === 0 ? (
        <p className={`${agentsMutedClass} rounded-xl border border-dashed border-zk-border p-5`}>
          No agent instructions yet. Add your first instruction below.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((preference) => {
            const editing = editingId === preference.id;
            return (
              <li key={preference.id} className="rounded-xl border border-zk-border bg-zk-surface p-4">
                {editing ? (
                  <form id={EDIT_FORM_ID} ref={editFormRef} onSubmit={submitEdit} noValidate className="space-y-3">
                    <label htmlFor={`edit-${preference.id}`} className={agentsLabelClass}>
                      Edit instruction
                    </label>
                    <textarea
                      id={`edit-${preference.id}`}
                      className={agentsInputClass}
                      rows={4}
                      value={draft}
                      maxLength={AGENT_PREFERENCE_CONTENT_MAX}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        editErrors.clear();
                      }}
                      {...editErrors.attrs("content")}
                    />
                    <FieldError formId={EDIT_FORM_ID} field="content" errors={editErrors.fieldErrors} />
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="submit" className={agentsPrimaryBtn} disabled={savePending}>
                        {savePending ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className={agentsSecondaryBtn} onClick={cancelEdit} disabled={savePending}>
                        Cancel
                      </button>
                      <span className="ml-auto font-mono text-xs tabular-nums text-zk-muted">
                        {draft.length}/{AGENT_PREFERENCE_CONTENT_MAX}
                      </span>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <p className="whitespace-pre-wrap break-words text-sm text-zk-text">{preference.content}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={agentsSecondaryBtn}
                        onClick={() => beginEdit(preference)}
                        disabled={savePending || deletePending}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={agentsDangerBtn}
                        onClick={() => void remove(preference)}
                        disabled={deletePending}
                      >
                        {deletePending ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3 border-t border-zk-border pt-5">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zk-text">Add an instruction</h3>
          <p className={agentsMutedClass}>
            One thing you want every agent to do, or never do. Up to {AGENT_PREFERENCE_CONTENT_MAX} characters.
          </p>
        </div>

        <form id={ADD_FORM_ID} ref={addFormRef} onSubmit={submitAdd} noValidate className="space-y-3">
          <label htmlFor="add-preference-content" className={agentsLabelClass}>
            New instruction
          </label>
          <textarea
            id="add-preference-content"
            className={agentsInputClass}
            rows={3}
            value={addText}
            maxLength={AGENT_PREFERENCE_CONTENT_MAX}
            placeholder="Run pnpm verify:ready before opening a pull request."
            onChange={(event) => {
              setAddText(event.target.value);
              addErrors.clear();
              setAddError(null);
            }}
            {...addErrors.attrs("content")}
          />
          <FieldError formId={ADD_FORM_ID} field="content" errors={addErrors.fieldErrors} />
          {addError && (
            <p role="alert" className="text-sm font-semibold text-zk-bad-fg">
              {addError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={agentsPrimaryBtn} disabled={addPending || atCap}>
              {addPending ? "Adding…" : "Add instruction"}
            </button>
            <span className="font-mono text-xs tabular-nums text-zk-muted">
              {addText.length}/{AGENT_PREFERENCE_CONTENT_MAX}
            </span>
            {atCap && <span className={agentsMutedClass}>You have reached the {AGENT_PREFERENCES_MAX}-instruction limit.</span>}
          </div>
        </form>
      </div>
    </AgentsSurface>
  );
}
