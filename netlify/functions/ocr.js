// 腾讯云 OCR 代理（可选）：把 SecretId/SecretKey 放服务器端，前端图片 base64 上传，密钥不出浏览器。
// 接口：通用印刷体识别 GeneralBasicOCR，支持中文/英文/越南语/泰语等 21 语种（各语种可混英文）。
//   官方文档：https://cloud.tencent.com/document/product/866/33526  （免费额度：开通后每月 1000 次）
// 部署（Netlify）：Build & Deploy → Environment variables 设
//   TENCENT_OCR_SECRET_ID / TENCENT_OCR_SECRET_KEY（腾讯云访问管理 CAM → API 密钥管理）。
//   前端 index.html 的 PT_OCR_PROXY 默认 '/.netlify/functions/ocr'，无需改。
// 返回约定：
//   { engine:'tencent', text, confidence, language, angle, count }  识别成功
//   { engine:'none' }                                                未配置密钥（前端回退本地识别）
//   statusCode 502 + { engine:'error', error_msg }                   已配置但调用失败
const crypto = require('crypto');

const SID = process.env.TENCENT_OCR_SECRET_ID;
const SKEY = process.env.TENCENT_OCR_SECRET_KEY;
const HOST = 'ocr.tencentcloudapi.com';
const ACTION = 'GeneralBasicOCR';
const VERSION = '2018-11-19';
const SERVICE = 'ocr';
// 语种映射：图片文字语种 -> 腾讯 LanguageType（zh=中英混合；en/mix 用语言混合自动检测；vie/tha 明确指定）
const LANGS = { zh: 'zh', en: 'mix', vi: 'vie', th: 'tha', mix: 'mix' };

function sha256hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function hmac(key, s) { return crypto.createHmac('sha256', key).update(s, 'utf8').digest(); }
function hmacHex(key, s) { return crypto.createHmac('sha256', key).update(s, 'utf8').digest('hex'); }

async function callOCR(secretId, secretKey, payload) {
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10); // UTC 日期
  const hashedPayload = sha256hex(payload);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + HOST +
    '\nx-tc-action:' + ACTION.toLowerCase() + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;
  const credentialScope = date + '/' + SERVICE + '/tc3_request';
  const stringToSign = 'TC3-HMAC-SHA256\n' + ts + '\n' + credentialScope + '\n' + sha256hex(canonicalRequest);
  const kDate = hmac('TC3' + secretKey, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmacHex(kSigning, stringToSign);
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

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json' };
  try {
    if (!SID || !SKEY) {
      return { statusCode: 200, headers, body: JSON.stringify({ engine: 'none' }) };
    }
    const { imageBase64, langKey } = JSON.parse(event.body || '{}');
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length > 7 * 1024 * 1024) {
      return { statusCode: 400, headers, body: JSON.stringify({ engine: 'error', error_msg: '图片过大或缺失（base64 上限 7MB）' }) };
    }
    const langType = LANGS[langKey] || 'mix';
    const payload = JSON.stringify({ ImageBase64: imageBase64, LanguageType: langType });
    const resp = await callOCR(SID, SKEY, payload);
    const dets = (resp && resp.TextDetections) || [];
    const lines = dets.map(function (d) { return d && d.DetectedText ? String(d.DetectedText) : ''; })
      .filter(function (t) { return t; });
    const confs = dets.map(function (d) { return typeof d.Confidence === 'number' ? d.Confidence : null; })
      .filter(function (c) { return c !== null; });
    const confidence = confs.length ? Math.min.apply(null, confs) : null;
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        engine: 'tencent',
        text: lines.join('\n'),
        confidence: confidence,
        language: (resp && resp.Language) || langType,
        angle: (resp && typeof resp.Angle === 'number') ? resp.Angle : null,
        count: dets.length
      })
    };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ engine: 'error', error_msg: String(e && e.message || e) }) };
  }
};
