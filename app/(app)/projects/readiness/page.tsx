import { RepositoryReadiness } from "@/components/repository-readiness";
import { loadRepositoryReadiness } from "@/lib/github/repository-readiness-query";

export const metadata = { title: "Repository readiness" };

export default async function RepositoryReadinessPage() {
  const result = await loadRepositoryReadiness();
  return <RepositoryReadiness key={result.ok ? result.report.organisationId : "load-error"} initial={result} />;
}
