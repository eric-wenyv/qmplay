import axios from "axios";
import { logger } from "./logger";

// Retain service diagnostics without logging queries, credentials or media URLs.
export function logServiceRequest(
  service: string,
  upstream: string,
  _params?: unknown,
  _extras?: unknown,
) {
  logger.debug("service.requesting", { service, upstream });
}
export function logServiceSuccess(
  service: string,
  upstream: string,
  _result?: unknown,
  _extras?: unknown,
) {
  logger.debug("service.succeeded", { service, upstream });
}
export function logServiceFailure(
  service: string,
  upstream: string,
  error: unknown,
  _params?: unknown,
  _extras?: unknown,
) {
  logger.warn("service.failed", {
    service,
    upstream,
    status: axios.isAxiosError(error) ? error.response?.status : undefined,
    code: axios.isAxiosError(error) ? error.code : "UPSTREAM_ERROR",
  });
}
export function logServiceBranch(
  service: string,
  upstream: string,
  branch: string,
  _details?: unknown,
) {
  logger.debug("service.branch_selected", { service, upstream, branch });
}
