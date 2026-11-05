import type { Metadata } from "next";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { ZEDU_SLUG } from "@/lib/tenant";
import { TENANT_NAME_MAX } from "@/lib/tenants";
import {
  deleteTenantAction,
  renameTenantAction,
  setTenantArchivedAction,
} from "@/app/(app)/tenants/actions";
import { loadOrg } from "../org-context";
import { OrgMessages, OrgPageHeader, ReadOnlyNote, oneParam, orgCard } from "../org-ui";

export const metadata: Metadata = { title: "Organization settings" };

const fieldClass =
  "min-w-0 flex-1 rounded-xl border border-zk-border bg-zk-surface px-3 py-1.5 text-sm text-zk-text";

/** Rename, archive or delete the organization. Owners (and the site super admin) only. */
export default async function OrgSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; notice?: string | string[] }>;
}) {
  const { org } = await loadOrg();
  if (!org) return null;
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OrgPageHeader title="Settings">
        The organization&apos;s name, and archiving or deleting it. Its URL id,{" "}
        <span className="font-mono">{org.slug}</span>, never changes, so existing links keep working.
      </OrgPageHeader>

      <OrgMessages error={oneParam(params.error)} notice={oneParam(params.notice)} />

      {org.owner ? null : (
        <ReadOnlyNote>Only owners can rename, archive or delete {org.name}.</ReadOnlyNote>
      )}

      <section aria-labelledby="org-name" className={orgCard}>
        <h3 id="org-name" className="text-base font-semibold text-zk-text">
          Display name
        </h3>
        {org.owner ? (
          <form action={renameTenantAction} className="mt-3 space-y-2">
            <input type="hidden" name="tenantId" value={org.id} />
            <label htmlFor="tenant-name" className="sr-only">
              Display name
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="tenant-name"
                name="name"
                defaultValue={org.name}
                maxLength={TENANT_NAME_MAX}
                required
                className={fieldClass}
              />
              <Button type="submit" variant="secondary">
                Save name
              </Button>
            </div>
            <p className="text-xs text-zk-muted">Shown in the header, the switcher and invites.</p>
          </form>
        ) : (
          <p className="mt-1 text-sm text-zk-text2">{org.name}</p>
        )}
      </section>

      {org.owner ? (
        org.slug === ZEDU_SLUG ? (
          <section className={orgCard}>
            <p className="text-sm text-zk-text2">
              Zedu is the default organization and can&apos;t be archived or deleted.
            </p>
          </section>
        ) : (
          <section aria-labelledby="org-danger" className="rounded-[20px] border border-zk-bad-bd bg-zk-surface p-4 sm:p-6">
            <h3 id="org-danger" className="text-base font-semibold text-zk-bad-fg">
              Archive or delete
            </h3>

            <form action={setTenantArchivedAction} className="mt-3 space-y-1">
              <input type="hidden" name="tenantId" value={org.id} />
              <input type="hidden" name="archived" value="true" />
              <p className="text-sm font-medium text-zk-text">Archive organization</p>
              <p className="text-xs text-zk-muted">
                Archiving hides it from the switcher and nobody can open it. Its issues and members stay,
                read-only. An owner can restore it from the workspaces list.
              </p>
              <div className="pt-1">
                <ConfirmSubmitButton
                  variant="secondary"
                  confirm={{
                    title: `Archive ${org.name}?`,
                    body: "Nobody can open it until an owner restores it from the workspaces list.",
                    confirmLabel: "Archive organization",
                  }}
                >
                  Archive organization
                </ConfirmSubmitButton>
              </div>
            </form>

            <form action={deleteTenantAction} className="mt-5 space-y-2 border-t border-zk-border pt-4">
              <input type="hidden" name="tenantId" value={org.id} />
              <p className="text-sm font-medium text-zk-text">Delete organization</p>
              <p className="text-xs text-zk-muted">
                Deleting is permanent and only works when the organization has no issues, agents or
                other members. Otherwise archive it instead.
              </p>
              <label htmlFor="confirm-tenant-name" className="block text-xs text-zk-text2">
                Type <span className="font-semibold text-zk-text">{org.name}</span> to confirm
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="confirm-tenant-name"
                  name="confirmName"
                  placeholder={org.name}
                  autoComplete="off"
                  required
                  className={fieldClass}
                />
                <ConfirmSubmitButton
                  confirm={{
                    title: `Delete ${org.name} permanently?`,
                    body: "This can't be undone.",
                    confirmLabel: "Delete organization",
                  }}
                >
                  Delete organization
                </ConfirmSubmitButton>
              </div>
            </form>
          </section>
        )
      ) : null}
    </div>
  );
}
