import type { BandClient } from "./client.js";
import { bandsResultSchema, type BandsResult } from "./types.js";

export async function listBands(client: BandClient): Promise<BandsResult> {
  return client.request(
    { method: "GET", path: "/v2.1/bands" },
    bandsResultSchema,
  );
}
