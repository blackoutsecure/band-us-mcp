import type { WorkerEnv } from "../env.js";

export interface CredentialStore {
  getBandAccessToken(): Promise<string | undefined>;
}

export function createSecretCredentialStore(
  env: WorkerEnv,
): CredentialStore {
  return {
    async getBandAccessToken(): Promise<string | undefined> {
      return env.BAND_ACCESS_TOKEN;
    },
  };
}
