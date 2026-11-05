"use client";

import { useState, useTransition } from "react";
import {
  createIssueTypeAction,
  deleteIssueTypeAction,
  toggleIssueTypeActiveAction,
  updateIssueTypeAction,
} from "@/app/actions/issue-types";
import { getIssueTypeBadgeClass } from "@/lib/issue-type-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_BUG_TEMPLATE, TEMPLATE_MAX } from "@/lib/issue-templates";
import { InUseNotice, type InUse } from "@/components/in-use-notice";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export interface IssueTypeWithCount {
  id: string;
  name: string;
  description: string | null;
  template?: string | null;
  isActive: boolean;
  createdAt: Date | string;
  _count: {
    bugs: number;
  };
}

export function AdminIssueTypesManager({
  types,
  deletedCounts = {},
}: {
  types: IssueTypeWithCount[];
  /** Soft-deleted issues per type, which block deletion but are hidden. */
  deletedCounts?: Record<string, number>;
}) {
  const [inUse, setInUse] = useState<InUse | null>(null);
  const [editingType, setEditingType] = useState<IssueTypeWithCount | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();

  function startCreate() {
    setName("");
    setDescription("");
    setTemplate("");
    setIsActive(true);
    setError(null);
    setEditingType(null);
    setIsCreating(true);
  }

  function startEdit(type: IssueTypeWithCount) {
    setName(type.name);
    setDescription(type.description ?? "");
    setTemplate(type.template ?? "");
    setIsActive(type.isActive);
    setError(null);
    setIsCreating(false);
    setEditingType(type);
  }

  function cancel() {
    setIsCreating(false);
    setEditingType(null);
    setError(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("template", template);
    formData.set("isActive", String(isActive));

    startTransition(async () => {
      try {
        let result;
        if (editingType) {
          result = await updateIssueTypeAction(editingType.id, formData);
        } else {
          result = await createIssueTypeAction(formData);
        }

        if (result.error) {
          setError(result.error);
        } else {
          cancel();
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      }
    });
  }

  function handleToggle(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleIssueTypeActiveAction(id);
        if (result.error) setError(result.error);
      } catch {
        setError("Failed to update status.");
      }
    });
  }

  async function handleDelete(type: IssueTypeWithCount) {
    if (type._count.bugs > 0) {
      setError(null);
      setInUse({
        id: type.id,
        name: type.name,
        // The list filters types through the tag filter, by name.
        filterValue: type.name,
        total: type._count.bugs,
        deleted: deletedCounts[type.id] ?? 0,
        isActive: type.isActive,
      });
      return;
    }
    setInUse(null);

    const confirmed = await confirm({
      title: `Delete issue type "${type.name}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete type",
      tone: "danger",
    });
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteIssueTypeAction(type.id);
        if (result.error) {
          setError(result.error);
          toast(result.error, "error");
        } else {
          toast(`Issue type "${type.name}" deleted.`);
        }
      } catch {
        setError("Failed to delete type.");
        toast("Failed to delete type.", "error");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zk-text">Issue types</h2>
          <p className="mt-1 max-w-2xl text-sm text-zk-text2">
            The kinds of issue people can file in this organization (Marketing, Design, Fix, Feat, etc.).
          </p>
        </div>
        {!isCreating && !editingType && (
          <Button onClick={startCreate}>Add new type</Button>
        )}
      </div>

      {inUse ? (
        <InUseNotice
          inUse={inUse}
          pending={pending}
          onDismiss={() => setInUse(null)}
          onDeactivate={() =>
            startTransition(async () => {
              try {
                const result = await toggleIssueTypeActiveAction(inUse.id);
                if (result.error) {
                  toast(result.error, "error");
                } else {
                  toast(`Issue type “${inUse.name}” deactivated.`);
                  setInUse(null);
                }
              } catch {
                toast("Failed to update status.", "error");
              }
            })
          }
        />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {(isCreating || editingType) && (
        <div className="rounded-xl border border-slate-200 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">
            {editingType ? `Edit "${editingType.name}"` : "Create new issue type"}
          </h2>
          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="typeName" className="text-sm font-medium text-slate-700">
                Name
              </label>
              <Input
                id="typeName"
                required
                minLength={2}
                maxLength={50}
                placeholder="e.g. Documentation"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="typeDescription" className="text-sm font-medium text-slate-700">
                Description (optional)
              </label>
              <Textarea
                id="typeDescription"
                rows={2}
                maxLength={300}
                placeholder="Brief description of when to select this type"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="typeTemplate" className="text-sm font-medium text-slate-700">
                Report template (optional)
              </label>
              <Textarea
                id="typeTemplate"
                rows={8}
                maxLength={TEMPLATE_MAX}
                aria-describedby="typeTemplateHelp"
                className="font-mono text-xs"
                placeholder={"### Steps to reproduce\n1.\n\n### Expected\n\n### Actual"}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              />
              <div id="typeTemplateHelp" className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Markdown. Pre-fills the description when a reporter picks this type. Leave
                  empty for no template.
                </span>
                {!template.trim() ? (
                  <button
                    type="button"
                    className="font-medium text-teal-700 hover:underline"
                    onClick={() => setTemplate(DEFAULT_BUG_TEMPLATE)}
                  >
                    Use the bug template
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="typeActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <label htmlFor="typeActive" className="text-sm font-medium text-slate-700">
                Active (available for selection on issue creation form)
              </label>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : editingType ? "Update type" : "Create type"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={cancel}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* #211: `overflow-hidden` clipped the Actions column on narrow screens,
          making Delete unreachable. Scroll instead, matching the users table
          in app/(app)/superadmin/users/page.tsx. */}
      <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-slate-200 bg-card shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Issues</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {types.map((type) => (
              <tr key={type.id} className="hover:bg-slate-50/80">
                <td className="px-4 py-3 font-medium text-slate-900">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getIssueTypeBadgeClass(
                      type.name,
                    )}`}
                  >
                    {type.name}
                  </span>
                </td>
                <td className="max-w-xs px-4 py-3 text-slate-600">
                  {type.description || <span className="text-slate-500">—</span>}
                  {type.template ? (
                    <span className="mt-1 block text-xs text-teal-700">Has a report template</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      type.isActive
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-600"
                    }
                  >
                    {type.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {type._count.bugs} issue{type._count.bugs === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => startEdit(type)}
                      className="inline-flex min-h-11 items-center text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline sm:min-h-0"
                    >
                      Edit
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleToggle(type.id)}
                      className="inline-flex min-h-11 items-center text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline sm:min-h-0"
                    >
                      {type.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleDelete(type)}
                      // Clickable when in use: it explains why it cannot
                      // delete rather than looking dead (#314). So no not-allowed cursor either.
                      className={`inline-flex min-h-11 items-center text-xs font-medium hover:underline sm:min-h-0 ${
                        type._count.bugs > 0
                          ? "text-slate-600 hover:text-slate-800"
                          : "text-red-600 hover:text-red-800"
                      }`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {types.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No issue types defined.
          </p>
        ) : null}
      </div>
    </div>
  );
}

