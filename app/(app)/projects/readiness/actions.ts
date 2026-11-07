"use server";

import { checkProjectDelivery, loadRepositoryReadiness } from "@/lib/github/repository-readiness-query";

/** Each invocation reauthorizes against the current organisation; no agent key is involved. */
export async function recheckRepositories() {
  return loadRepositoryReadiness();
}

export async function checkDelivery(input: unknown) {
  return checkProjectDelivery(input);
}
