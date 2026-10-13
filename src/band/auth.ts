import { IntegrationError } from "../errors.js";
import type { CredentialStore } from "../storage/index.js";

export async function getBandAccessToken(
  store: CredentialStore,
): Promise<string> {
  const token = await store.getBandAccessToken();
  if (
    !token ||
    token !== token.trim() ||
    token.startsWith("replace-") ||
    token.length > 4096
  ) {
    throw new IntegrationError(
      "NOT_CONFIGURED",
      "A private BAND access token must be configured by the operator.",
      "configuration",
    );
  }
  return token;
}
