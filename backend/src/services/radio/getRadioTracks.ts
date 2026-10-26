import UCommon from "../UCommon/UCommon";

// QQ's radio catalogue and radio song batches are separate upstream methods.
export default async (id: number, firstplay: number) => {
  const { data: response } = await UCommon({
    params: {
      format: "json",
      data: JSON.stringify({
        comm: { ct: 24, cv: 0 },
        radio: {
          module: "pf.radiosvr",
          method: "GetRadiosonglist",
          param: { id, firstplay, num: 20 },
        },
      }),
    },
  });
  return response;
};
