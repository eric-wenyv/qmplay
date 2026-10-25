import { AxiosRequestConfig } from 'axios';
import { apiConfig, requestConfig } from '../config';
import { BaseUCommonParams } from '../types/core/request';
import request from '../util/request';

export default ({ options = {}, method = 'get' }: BaseUCommonParams) => {
  const opts: AxiosRequestConfig = Object.assign({}, options, apiConfig.commonParams, {
    headers: {
      referer: requestConfig.referer.u,
      host: 'u.y.qq.com',
      'content-type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  });
  return request(requestConfig.baseURL.u, method, opts, 'u');
};
