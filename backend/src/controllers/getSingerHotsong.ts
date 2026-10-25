import { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { z } from 'zod';

const { UCommon } = services;

// singermid=0025NhlN2yWrP4

interface SingerHotsongQuery {
  singermid: string;
  limit?: string | number;
  page?: string | number;
}

export default async (ctx: Context) => {
  const query = getTypedQuery<SingerHotsongQuery>(ctx);
  const parsed = z.object({
    singermid: z.string().regex(/^[\w-]{1,100}$/),
    limit: z.coerce.number().int().min(1).max(50).default(50),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  }).safeParse(query);
  if (!parsed.success) ctx.throw(400);
  const { singermid, limit: num, page } = parsed.data;
  const data = {
    comm: {
      ct: 24,
      cv: 0,
    },
    singer: {
      method: 'get_singer_detail_info',
      param: {
        sort: 5,
        singermid,
        sin: (page - 1) * num,
        num,
      },
      module: 'music.web_singer_info_svr',
    },
  };
  const params = Object.assign({
    format: 'json',
    singermid,
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
  if (singermid) {
    await UCommon(props)
      .then((res: import('axios').AxiosResponse<any>) => {
        const response = res.data;
        ctx.status = 200;
        ctx.body = {
          response,
        };
      })
      .catch((error: unknown) => {
        throw error;
      });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'no singermid',
    };
  }
};
