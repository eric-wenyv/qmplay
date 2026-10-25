import { AxiosRequestConfig } from 'axios';
import { apiConfig, requestConfig } from '../config';
import { BaseYCommonParams } from '../types/core/request';
import request from '../util/request';

export default ({
  url,
  method = 'get',
  options = {},
  hasCommonParams = true,
}: BaseYCommonParams) => {
  const commonParams = hasCommonParams ? apiConfig.commonParams : {};
  const opts: AxiosRequestConfig = Object.assign({}, options, commonParams, {
    headers: {
      referer: requestConfig.referer.c,
      host: 'c.y.qq.com',
      ...options.headers,
    },
  });
  return request(url, method, opts);
};
