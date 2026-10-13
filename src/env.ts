export interface WorkerEnv {
  readonly MCP_AUTH_TOKEN?: string;
  readonly BAND_ACCESS_TOKEN?: string;
  readonly BAND_ENABLE_WRITES?: string;
  readonly BAND_WRITE_BAND_KEYS?: string;
  readonly MCP_ALLOWED_ORIGINS?: string;
}
