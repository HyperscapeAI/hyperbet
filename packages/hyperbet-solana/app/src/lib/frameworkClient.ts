import { getCluster, getRpcUrl, getWsUrl } from "./config";
import { createFrameworkClient as createSharedFrameworkClient } from "@hyperbet/ui/lib/solanaRuntime";

export function createFrameworkClient() {
  return createSharedFrameworkClient({
    getCluster,
    getRpcUrl,
    getWsUrl,
  });
}
