import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { projectRef } from "@/lib/project-paths";

/** Every page under `/<slug>/marketing` has the section's header. Each page still checks access itself. */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project } = await params;
  return (
    <>
      <MarketingNav slug={projectRef(org, project)} />
      {children}
    </>
  );
}
