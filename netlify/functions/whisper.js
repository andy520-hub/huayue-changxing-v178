// OpenAI Whisper 语音识别（ASR）服务端代理：前端录音后把 16k 单声道 WAV(base64) 传这里，
// 本函数换 Bearer 令牌后调 OpenAI，返回 {text} 或 {err}。V1.6.0 起支持中文/越南语/泰语/英语，准确度远高于浏览器内置。
//
// 为什么必须走代理：
//   1) 浏览器无法跨域直连 OpenAI（无 CORS）；
//   2) API Key 绝不能放前端（会被扒走无限刷额度）。
//
// 部署（Netlify）：
//   1) 用 netlify-cli 部署：`netlify deploy --prod --dir .`（拖拽上传「Drop」不支持函数）。
//   2) Build & Deploy → Environment variables 设 OPENAI_APIKEY；可选 WHISPER_MODEL（默认 whisper-1，
//      也可填 gpt-4o-transcribe / gpt-4o-mini-transcribe 以提升准确度/速度）。
//   3) 前端 index.html 把 WHISPER_PROXY 填为 '/.netlify/functions/whisper'。
//
// 其他平台：Vercel 把本文件放到 api/whisper.js 并导出 `export default async (req,res)=>{...}`；
//   任意 Node18+ 服务按相同逻辑写即可（需全局 FormData / Blob，Node18 已内置）。
// 申请密钥：https://platform.openai.com/api-keys

const APIKEY = process.env.OPENAI_APIKEY;
const MODEL = process.env.WHISPER_MODEL || 'whisper-1';

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    if (!APIKEY) {
      return { statusCode: 200, headers, body: JSON.stringify({ err: '服务端未配置 OPENAI_APIKEY（在部署平台的环境变量里设置）' }) };
    }
    const { audio, lang } = JSON.parse(event.body || '{}');
    if (!audio) return { statusCode: 200, headers, body: JSON.stringify({ err: '缺少音频数据' }) };

    // base64(WAV) → Buffer → multipart/form-data（OpenAI 要求 form 上传文件）
    const wav = Buffer.from(audio, 'base64');
    const fd = new FormData();
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    fd.append('model', MODEL);
    if (lang && lang !== 'auto') fd.append('language', lang); // vi / th / en / zh，限定语种可提升准确度
    fd.append('response_format', 'json');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + APIKEY },
        body: fd,
        signal: ctrl.signal
      });
    } finally { clearTimeout(t); }

    const j = await resp.json();
    if (j && j.text) {
      return { statusCode: 200, headers, body: JSON.stringify({ text: j.text }) };
    }
    const errMsg = (j && j.error && (j.error.message || j.error)) || ('HTTP ' + resp.status);
    return { statusCode: 200, headers, body: JSON.stringify({ err: 'Whisper 识别失败：' + errMsg }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ err: e.name === 'AbortError' ? 'Whisper 请求超时' : String(e.message || e) }) };
  }
};
