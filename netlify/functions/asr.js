// 百度语音识别（ASR）服务端代理：前端录音后把 WAV(base64) 传这里，本函数换 token 后调百度，返回 {text} 或 {err}。
//
// 为什么必须走代理：
//   1) 浏览器无法跨域直连百度（无 CORS）；
//   2) Secret Key 绝不能放前端（会被扒走无限刷额度）。
//
// 部署（Netlify）：
//   1) 用 netlify-cli 部署（拖拽上传「Drop」不支持函数）：`netlify deploy --prod --dir .`
//      或在后台「Connect to Git」连上含本文件夹的仓库。
//   2) Build & Deploy → Environment variables 设 BAIDU_ASR_APIKEY / BAIDU_ASR_SECRET。
//   3) 前端 index.html 把 BAIDU_ASR_PROXY 填为 '/.netlify/functions/asr'。
//
// 其他平台：Vercel 把本文件放到 api/asr.js 并导出 `export default async (req,res)=>{...}`；任意 Node 服务按相同逻辑写即可。
// 申请密钥：https://console.bce.baidu.com/ai → 语音技术 → 创建应用（与翻译密钥是两套，不要混用）。

const APIKEY = process.env.BAIDU_ASR_APIKEY;
const SECRET = process.env.BAIDU_ASR_SECRET;
let tokenCache = { token: '', exp: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now + 60000) return tokenCache.token;
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id='
    + encodeURIComponent(APIKEY) + '&client_secret=' + encodeURIComponent(SECRET);
  const r = await fetch(url);
  const j = await r.json();
  if (!j.access_token) throw new Error('获取百度 token 失败：' + (j.error_description || j.error || '未知错误'));
  tokenCache = { token: j.access_token, exp: now + ((j.expires_in || 0) * 1000) };
  return j.access_token;
}

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    if (!APIKEY || !SECRET) {
      return { statusCode: 200, headers, body: JSON.stringify({ err: '服务端未配置百度语音密钥（BAIDU_ASR_APIKEY / BAIDU_ASR_SECRET）' }) };
    }
    const { audio, len } = JSON.parse(event.body || '{}');
    if (!audio) return { statusCode: 200, headers, body: JSON.stringify({ err: '缺少音频数据' }) };

    const token = await getToken();
    const cuid = 'huayue-pwa';
    const dev_pid = 1537; // 普通话(输入法模型)，带标点
    const url = 'https://vop.baidubce.com/server_api?dev_pid=' + dev_pid
      + '&token=' + encodeURIComponent(token) + '&cuid=' + encodeURIComponent(cuid);
    const payload = { format: 'wav', rate: 16000, channel: 1, speech: audio, len: len };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    } finally { clearTimeout(t); }

    const j = await resp.json();
    if (j.err_no === 0 && j.result && j.result.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ text: j.result.join('') }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ err: '百度识别失败：' + (j.err_msg || ('err_no ' + j.err_no)) }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ err: e.name === 'AbortError' ? '百度请求超时' : String(e.message || e) }) };
  }
};
