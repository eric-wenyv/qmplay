import { defaultConfig } from './default';
import { AppConfigSchema } from './schema';

// The embedded service has no configuration editor or writable installation files.
// Authentication data is managed separately by SessionStore.
export const appConfig = AppConfigSchema.parse(defaultConfig);
export const serverConfig = appConfig.server;
export const requestConfig = appConfig.request;
export const apiConfig = appConfig.api;
export const commonParams = appConfig.api.commonParams;
export const _guid = appConfig.api._guid;
export const userInfo = appConfig.user;
