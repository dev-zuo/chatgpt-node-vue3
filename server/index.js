const Koa = require("koa");
const KoaStatic = require("koa-static");
const KoaRouter = require("koa-router");
const session = require("koa-session");
const bodyParser = require("koa-bodyparser");
const path = require("path");
const fs = require("fs");
const dayjs = require("dayjs");

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
const connectOpenAI = async () => {
  let { apiKey } = await import("../config/api-key.mjs");
  const configuration = new Configuration({
    //  organization: "YOUR_ORG_ID", // just for multiple organizations
    apiKey: apiKey,
  });
  openai = new OpenAIApi(configuration);
};

connectOpenAI();

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
    // Cannot read properties of undefined (reading '0')
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
