import { syncUnifiedAgentHomes } from "../../../ai-os/src/triad/index.ts";

export interface SyncConfigReport {
  updatedFiles: string[];
  backupsCreated: string[];
}

/**
 * Compatibility shim: AI-Triad & MCP configuration ownership now lives exclusively in
 * `@aphrody/ai-os` (`C:/src/packages/ai-os/src/triad/index.ts`), wiring `ai-os` as the
 * single unified context-optimized MCP across all agent homes.
 */
export function syncAllTriadConfigs(options?: {
  home?: string;
  srcRoot?: string;
}): SyncConfigReport {
  const res = syncUnifiedAgentHomes(options);
  return {
    updatedFiles: res.updatedFiles,
    backupsCreated: res.backupsCreated,
  };
}
