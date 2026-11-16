// 可选·服务端代理：把百度密钥放在服务器端，前端用 BAIDU_PROXY_URL 指向本函数，密钥不出浏览器。
// V1.6.0：from/to 为透传，前端四语种 zh / vie / en / th 均可用（无需改本文件逻辑）。
//
// 部署（Netlify）：
//   1) 用 netlify-cli 部署（不是 Drag 拖拽，拖拽不支持函数）：`netlify deploy --prod --dir .`
//      或在 Netlify 后台「Connect to Git」连上含本文件夹的仓库。
//   2) 后台 Build & Deploy → Environment variables 设 BAIDU_APPID / BAIDU_KEY。
//   3) 前端 index.html 把 BAIDU_PROXY_URL 填为 '/.netlify/functions/translate'。
//
// Vercel 等价物：新建 api/translate.js，内容相同，导出 `export default async (req,res)=>{...}` 即可。
const crypto = require('crypto');
const APPID = process.env.BAIDU_APPID;
const KEY = process.env.BAIDU_KEY;

exports.handler = async (event) => {
  try {
    const { q, from, to } = JSON.parse(event.body || '{}');
    if (!q) return { statusCode: 400, body: JSON.stringify({ error_code: 1, error_msg: 'missing q' }) };
    const salt = Date.now().toString();
    const sign = crypto.createHash('md5').update(APPID + q + salt + KEY).digest('hex');
    const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate?q=' + encodeURIComponent(q)
      + '&from=' + from + '&to=' + to + '&appid=' + encodeURIComponent(APPID)
      + '&salt=' + encodeURIComponent(salt) + '&sign=' + encodeURIComponent(sign);
    const r = await fetch(url);
    const j = await r.json();
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(j) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error_code: 2, error_msg: String(e) }) };
  }
};
