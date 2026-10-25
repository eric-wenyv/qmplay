import axios, { AxiosRequestConfig, AxiosResponse, Method, ResponseType } from 'axios';
import { requestConfig } from '../config';
import { logger } from './logger';

// Keep public data requests separate from the authenticated client's defaults.
export default async function request<T = unknown>(
  url: string,
  method: string,
  options: AxiosRequestConfig = {},
  origin = 'c',
): Promise<AxiosResponse<T>> {
  const address = origin === 'u'
    ? url
    : (origin === 'y' ? requestConfig.baseURL.y : requestConfig.baseURL.c) + url;
  try {
    return await axios<T>({
      timeout: requestConfig.timeout,
      withCredentials: requestConfig.withCredentials,
      responseType: requestConfig.responseType as ResponseType,
      ...options,
      url: address,
      method: method.toLowerCase() as Method,
    });
  } catch (error) {
    // Axios errors can carry request headers and signed URLs. Log only safe fields.
    const destination = new URL(address);
    logger.warn('upstream.unavailable', {
      host: destination.host,
      path: destination.pathname,
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      code: axios.isAxiosError(error) ? error.code : 'NETWORK_ERROR',
    });
    throw error;
  }
}
