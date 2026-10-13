import type { WorkerEnv } from "../env.js";
import { IntegrationError } from "../errors.js";
import type { BandClient } from "./client.js";
import {
  rawPermissionsResultSchema,
  type BandPermission,
  type PermissionsResult,
} from "./types.js";

export async function checkPermissions(
  client: BandClient,
  bandKey: string,
  permissions: readonly BandPermission[],
): Promise<PermissionsResult> {
  return client.request(
    {
      method: "GET",
      path: "/v2/band/permissions",
      parameters: { band_key: bandKey, permissions: permissions.join(",") },
    },
    rawPermissionsResultSchema,
  );
}

export async function requireWritePermission(
  client: BandClient,
  env: WorkerEnv,
  bandKey: string,
  permission: BandPermission,
): Promise<void> {
  if (env.BAND_ENABLE_WRITES !== "true") {
    if (
      env.BAND_ENABLE_WRITES !== undefined &&
      env.BAND_ENABLE_WRITES !== "false"
    ) {
      throw new IntegrationError(
        "NOT_CONFIGURED",
        "BAND_ENABLE_WRITES must be exactly true or false.",
        "configuration",
      );
    }
    throw new IntegrationError(
      "PERMISSION_DENIED",
      "State-changing tools are disabled by the operator.",
      "permission",
    );
  }
  const allowed = env.BAND_WRITE_BAND_KEYS?.split(",").map((key) => key.trim());
  if (!allowed?.includes(bandKey)) {
    throw new IntegrationError(
      "PERMISSION_DENIED",
      "The requested Band is not approved for state-changing operations.",
      "permission",
    );
  }
  const result = await checkPermissions(client, bandKey, [permission]);
  if (!result.permissions.includes(permission)) {
    throw new IntegrationError(
      "PERMISSION_DENIED",
      "The BAND account does not have the required permission.",
      "permission",
    );
  }
}
