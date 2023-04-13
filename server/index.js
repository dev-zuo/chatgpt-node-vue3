const Koa = require("koa");
const KoaStatic = require("koa-static");
const KoaRouter = require("koa-router");
const session = require("koa-session");
const bodyParser = require("koa-bodyparser");
const path = require("path");
const fs = require("fs");
const dayjs = require("dayjs");
const { PassThrough } = require("stream");
require("isomorphic-fetch");

const app = new Koa();
app.use(new KoaStatic(path.resolve(__dirname, "../fe")));

const router = new KoaRouter();
app.use(bodyParser()); // 处理 post 请求参数

// 参数文件中的密码配置
let argsInfo = fs
  .readFileSync(path.resolve(__dirname, "./args.json"))
  .toString();
let args = {};
try {
  args = JSON.parse(argsInfo);
} catch (e) {
  console.warn(e);
}

// 集成 session
app.keys = [`${args.password}`]; // 'some secret hurr'
const CONFIG = {
  key: "koa:sess" /** (string) cookie key (default is koa:sess) */,
  /** (number || 'session') maxAge in ms (default is 1 days) */
  /** 'session' will result in a cookie that expires when session/browser is closed */
  /** Warning: If a session cookie is stolen, this cookie will never expire */
  maxAge: 1 * 3600 * 1000, // 0.5h
  overwrite: true /** (boolean) can overwrite or not (default true) */,
  httpOnly: true /** (boolean) httpOnly or not (default true) */,
  signed: true /** (boolean) signed or not (default true) */,
  rolling: false /** (boolean) Force a session identifier cookie to be set on every response. The expiration is reset to the original maxAge, resetting the expiration countdown. (default is false) */,
  renew: false /** (boolean) renew session when session is nearly expired, so we can always keep user logged in. (default is false)*/,
};
app.use(session(CONFIG, app));

router.get("/isLogin", async (ctx) => {
  ctx.body = {
    code: 0,
    data: !!ctx.session.isLogin,
    msg: "false 未登录，true 登录",
  };
});

router.post("/login", async (ctx) => {
  let code = 0;
  let msg = "登录成功";
  let { password } = ctx.request.body;
  if (password === `${args.password}`) {
    ctx.session.isLogin = true;
  } else {
    code = -1;
    msg = "密码错误";
  }
  ctx.body = {
    code,
    msg,
  };
});

const { Configuration, OpenAIApi } = require("openai");
let openai = "";
let chatgptApi = "";
const connectOpenAI = async () => {
  let { apiKey } = await import("../config/api-key.mjs");
  const configuration = new Configuration({
    //  organization: "YOUR_ORG_ID", // just for multiple organizations
    apiKey: apiKey,
  });
  openai = new OpenAIApi(configuration);
  const { ChatGPTAPI } = await import("chatgpt");
  chatgptApi = new ChatGPTAPI({ apiKey });
};

connectOpenAI();

// SSE 请求，不返回标准 JSON，而是 UTF-8 文本
const CLOSE_MARK_MSG = "--dev-zuo[DONE]dev-zuo--";
router.get("/open-ai/sendMsg", async (ctx) => {
  ctx.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const steamData = new PassThrough();
  ctx.body = steamData;
  if (!ctx.session.isLogin) {
    let notLogin = {
      code: -2,
      msg: "未登录",
    };
    console.log("res", JSON.stringify(notLogin));
    // 格式为 `data:xxx\n\n` 前面 data，后面 \n\n 这种前端才能正常收到消息
    steamData.write(`data:${JSON.stringify(notLogin)}\n\n`);
    // 通知前端接口已完成请求，关闭 EventSource 连接
    steamData.write(`data:${CLOSE_MARK_MSG}\n\n`);
    return;
  }
  // // mock 数据测试，每隔 300 ms 发送数字给前端，1-29
  // let i = 1;
  // let END_COUNT = 30
  // let timer = setInterval(() => {
  //   steamData.write(`data:${i++}\n\n`);
  //   if (i === END_COUNT) {
  //     console.log(`${i}`)
  //     steamData.write(`data:${CLOSE_MARK_MSG}\n\n`);
  //     clearInterval(timer)
  //   }
  // }, 300)

  let { chatContent } = ctx.request.query;
  // form npm package "chatgpt"
  console.log("****>>chatgptAPI", chatgptApi);
  // steamData.write(`data:开始请求\n\n`);
  // https://www.npmjs.com/package/chatgpt
  // 不能用 await，因为会导致所有信息完成后，才一次性 response 到前端
  chatgptApi.sendMessage(chatContent, {
    // print the partial response as the AI is "typing"
    onProgress: (partRes) => {
      console.log(JSON.stringify(partRes));
      // JSON.stringify('xxx') => '"xxx"'
      steamData.write(`data:${JSON.stringify(partRes.text)}\n\n`);
      // {"role":"assistant","id":"chatcmpl-74YzUfLNYFwbATCpNNEyg55UeAwi7","parentMessageId":"9a9fd7a2-8b9b-4e40-96ab-176bf80f1f43","text":"您好！","detail":{"id":"chatcmpl-74YzUfLNYFwbATCpNNEyg55UeAwi7","object":"chat.completion.chunk","created":1681322172,"model":"gpt-3.5-turbo-0301","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}}
      if (partRes.detail.choices[0].finish_reason === "stop") {
        console.log("响应已结束", partRes.text); // print the full text at the end
        steamData.write(`data:${CLOSE_MARK_MSG}\n\n`);
        steamData.end();
      }
    },
  });
});

router.post("/open-ai/sendMsg", async (ctx) => {
  if (!ctx.session.isLogin) {
    ctx.body = {
      code: -2,
      msg: "未登录",
    };
    return;
  }

  let { chatContent, stream } = ctx.request.body;
  try {
    // 对话
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: chatContent }],
      stream, // 是否是数据流，默认为 false
    });
    console.log("result", completion.data);
    console.log("result", completion.data.choices[0].message);
    ctx.body = {
      code: 0,
      data: completion.data.choices[0].message,
      msg: "成功",
    };
  } catch (e) {
    ctx.body = {
      code: -1,
      msg: e.message,
    };
  }
});

const { base64Res } = require("../mock/imgGenerateBase64.js");
const base64ToImage = (base64String, fileName) => {
  // remove data:image/png;base64, from base64String
  // "data:image/png;base64,xxxx" => "xxxx"
  const base64Image = base64String.split(";base64,").pop();

  // create buffer from base64Image
  const imageBuffer = Buffer.from(base64Image, "base64");

  // create folder if it doesn't exists
  const folderPath = path.resolve(__dirname, "../fe/images");
  console.log(folderPath);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
  }

  // write buffer to file
  const filePath = path.join(folderPath, fileName);
  fs.writeFileSync(filePath, imageBuffer, { encoding: "base64" });

  return filePath;
};
router.post("/open-ai/imageGenerate", async (ctx) => {
  if (!ctx.session.isLogin) {
    ctx.body = {
      code: -2,
      msg: "未登录",
    };
    return;
  }

  // {
  //     "prompt": "A cute baby sea otter",
  //     "n": 2,
  //     "size": "1024x1024"
  // }
  let { prompt, imgCount, imgSize, responseFormat } = ctx.request.body;
  console.log(prompt, imgCount, imgSize, responseFormat);
  console.log(ctx.request.header.referer);
  try {
    // const res = {data: base64Res } // mock
    // 图片生成
    const res = await openai.createImage({
      prompt, // "A cute baby sea otter",
      n: imgCount || 1, // Defaults to 1 数字
      size: imgSize || "1024x1024", // Defaults to "1024x1024" 字符串
      response_format: responseFormat || "url", // b64_json
    });
    console.log("img generate result", res.data);
    // 由于图片生成 url 时，openai url 响应较慢，data: [ { url: ''}]
    // 这里使用图片 base64 字符串格式，将图片存储到服务端，再提供给前端一个本地的链接
    // 用于提升图片显示速度

    console.log("responseFormat", responseFormat);
    if (responseFormat === "url") {
      ctx.body = {
        code: 0,
        data: res.data.data, // res.data = { created: 时间戳, data: [ url: ]}
        msg: "成功",
      };
    } else {
      // data = [ { b64_json: } ] // data:image/jpg;base64,
      let data = res.data.data;
      // console.log('xxx', data[0].b64_json)
      // console.log(data)
      let resultData = []; // [ { url: 'http://xxx'} ]
      for (let i = 0, len = data.length; i < len; i++) {
        let item = data[i]; // { b64_json: 'xxx' }
        // 生成图片路径、存储图片
        // Math.floor(Math.radom() * 100)
        let fileName = `${dayjs().format("YYYY_MM_DD_HH_mm_ss")}_${Math.floor(
          Math.random() * 100
        )}.png`;
        console.log(fileName);
        base64ToImage(item.b64_json, fileName);
        resultData.push({
          // url: `http://openai.zuo11.com/images/${fileName}`
          url: `${ctx.request.header.referer}images/${fileName}`,
        });
      }
      ctx.body = {
        code: 0,
        data: resultData, // [ { url: }]
        msg: "成功",
      };
    }
  } catch (e) {
    console.log("error", e);
    ctx.body = {
      code: -1,
      msg: e.message,
    };
  }
});

app.use(router.routes()).use(router.allowedMethods());
app.listen(9000, () => console.log("服务开启于 9000 端口"));
