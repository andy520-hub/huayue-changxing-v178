// 腾讯云 OCR 代理（Cloudflare Pages Function，可选）
// 把 SecretId/SecretKey 放 Cloudflare Pages 环境变量，前端图片 base64 上传，密钥不出浏览器。
// 接口：通用印刷体识别 GeneralBasicOCR，支持中文/英文/越南语/泰语等 21 语种（各语种可混英文）。
//   官方文档：https://cloud.tencent.com/document/product/866/33526  （免费额度：开通后每月 1000 次）
// 配置：Cloudflare Pages → Settings → Environment variables 设
//   TENCENT_OCR_SECRET_ID / TENCENT_OCR_SECRET_KEY（腾讯云访问管理 CAM → API 密钥管理）。
//   前端 index.html 的 PT_OCR_PROXY 默认 '/api/ocr'（本文件路由 /functions/api/ocr.js），无需改。
// 签名：腾讯云 API 3.0 TC3-HMAC-SHA256，用 Web Crypto API（Cloudflare Workers/Pages 原生支持，无需 Node crypto）。
// 返回约定：
//   { engine:'tencent', text, confidence, language, angle, count }  识别成功
//   { engine:'none' }                                                未配置密钥（前端回退本地识别）
//   502 + { engine:'error', error_msg }                              已配置但调用失败
const HOST = 'ocr.tencentcloudapi.com';
const ACTION = 'GeneralBasicOCR';
const VERSION = '2018-11-19';
const SERVICE = 'ocr';
// 语种映射：图片文字语种 -> 腾讯 LanguageType（zh=中英混合；en/mix 用语言混合自动检测；vie/tha 明确指定）
const LANGS = { zh: 'zh', en: 'mix', vi: 'vie', th: 'tha', mix: 'mix' };

const te = new TextEncoder();
function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(s) {
  return toHex(await crypto.subtle.digest('SHA-256', te.encode(s)));
}
async function hmacRaw(key, s) {
  const k = await crypto.subtle.importKey('raw',
    typeof key === 'string' ? te.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, te.encode(s));
}
async function hmacHex(key, s) {
  return toHex(await hmacRaw(key, s));
}

async function callOCR(secretId, secretKey, payload) {
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10); // UTC 日期
  const hashedPayload = await sha256Hex(payload);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + HOST +
    '\nx-tc-action:' + ACTION.toLowerCase() + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;
  const credentialScope = date + '/' + SERVICE + '/tc3_request';
  const stringToSign = 'TC3-HMAC-SHA256\n' + ts + '\n' + credentialScope + '\n' + await sha256Hex(canonicalRequest);
  const kDate = await hmacRaw('TC3' + secretKey, date);
  const kService = await hmacRaw(kDate, SERVICE);
  const kSigning = await hmacRaw(kService, 'tc3_request');
  const signature = await hmacHex(kSigning, stringToSign);
  const authorization = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  const r = await fetch('https://' + HOST, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': ACTION,
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(ts)
    },
    body: payload
  });
  const j = await r.json();
  if (j.Response && j.Response.Error) {
    throw new Error(j.Response.Error.Code + ': ' + j.Response.Error.Message);
  }
  return j.Response || j;
}

export async function onRequestPost(context) {
  const headers = { 'content-type': 'application/json' };
  try {
    const SID = context.env.TENCENT_OCR_SECRET_ID;
    const SKEY = context.env.TENCENT_OCR_SECRET_KEY;
    if (!SID || !SKEY) {
      return new Response(JSON.stringify({ engine: 'none' }), { status: 200, headers });
    }
    let body = {};
    try { body = await context.request.json(); } catch (e) {}
    const imageBase64 = body.imageBase64;
    const langKey = body.langKey;
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length > 7 * 1024 * 1024) {
      return new Response(JSON.stringify({ engine: 'error', error_msg: '图片过大或缺失（base64 上限 7MB）' }),
        { status: 400, headers });
    }
    const langType = LANGS[langKey] || 'mix';
    const payload = JSON.stringify({ ImageBase64: imageBase64, LanguageType: langType });
    const resp = await callOCR(SID, SKEY, payload);
    const dets = (resp && resp.TextDetections) || [];
    const lines = dets.map(d => d && d.DetectedText ? String(d.DetectedText) : '').filter(t => t);
    const confs = dets.map(d => typeof d.Confidence === 'number' ? d.Confidence : null).filter(c => c !== null);
    const confidence = confs.length ? Math.min.apply(null, confs) : null;
    return new Response(JSON.stringify({
      engine: 'tencent',
      text: lines.join('\n'),
      confidence: confidence,
      language: (resp && resp.Language) || langType,
      angle: (resp && typeof resp.Angle === 'number') ? resp.Angle : null,
      count: dets.length
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ engine: 'error', error_msg: String(e && e.message || e) }),
      { status: 502, headers });
  }
}
