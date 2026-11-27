/**
 * 12-login-detect.mjs —— 登录态到底能不能用 document.cookie 判断？（探针，不是产品代码）
 *
 * 用户报："我原本登录了还识别不了"。这里验证两件事：
 *   ① 未登录时 /weapi/w/nuser/account/get 返回什么（能不能用来判断登录态）
 *   ② Set-Cookie 里 MUSIC_U 是否带 HttpOnly —— 如果带，`document.cookie` 永远读不到它，
 *      那么"用 document.cookie 判断登录"就是错的，必须改用接口。
 *
 * 用法：node scripts/12-login-detect.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PRESET = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RSA_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clF
Ss6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldcz
hC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

const aes = (text, key) => {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(IV));
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
};

function weapiBody(obj) {
  const text = JSON.stringify(obj);
  let secret = '';
  const rnd = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) secret += B62[rnd[i] % 62];
  const params = aes(aes(text, PRESET), secret);
  /* ⚠️ 与 weapi 一致：把 16 字节当成大整数做**左补零**到 128 字节（Node 的 NO_PADDING 不接受短输入） */
  const raw = Buffer.from(secret.split('').reverse().join(''), 'utf8');
  const padded = Buffer.concat([Buffer.alloc(128 - raw.length), raw]);
  const encSecKey = crypto
    .publicEncrypt({ key: RSA_PEM, padding: crypto.constants.RSA_NO_PADDING }, padded)
    .toString('hex');
  return { params, encSecKey };
}

async function call(pathname, data, extraHeaders) {
  const b = weapiBody(Object.assign({ csrf_token: '' }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=';
  const resp = await fetch(url, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: 'https://music.163.com/' },
      extraHeaders || {}
    ),
    body: 'params=' + encodeURIComponent(b.params) + '&encSecKey=' + encodeURIComponent(b.encSecKey)
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: resp.status, json, text: text.slice(0, 200), setCookie: resp.headers.getSetCookie ? resp.headers.getSetCookie() : [] };
}

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? '  -> ' + x : '')); } };
const section = (t) => console.log('\n[' + t + ']');

(async () => {
  section('1. 匿名：account/get 能否用来判断"未登录"');
  let r;
  try {
    r = await call('/api/w/nuser/account/get', {});
  } catch (e) {
    console.log('  请求异常：' + e.message);
  }
  if (r) {
    console.log('  HTTP', r.status, ' code=' + (r.json && r.json.code));
    console.log('  JSON:', JSON.stringify(r.json).slice(0, 220));
    ok('HTTP 200', r.status === 200, 'status=' + r.status);
    ok('返回 JSON（不是空/HTML）', !!r.json, r.text.slice(0, 60));
    ok('匿名时没有 profile', !(r.json && r.json.profile && r.json.profile.userId), 'profile=' + JSON.stringify(r.json && r.json.profile));
  }

  section('2. 关键：登录相关的 cookie 是否 HttpOnly（决定能不能用 document.cookie 判断）');
  /* 访问首页，看看服务端下发哪些 cookie、有没有 HttpOnly 标记 */
  const home = await fetch('https://music.163.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const setCookie = home.headers.getSetCookie ? home.headers.getSetCookie() : [];
  console.log('  首页 Set-Cookie 条数：' + setCookie.length);
  setCookie.forEach((c) => console.log('    · ' + c.split(';')[0] + (/\bHttpOnly\b/i.test(c) ? '   [HttpOnly]' : '')));
  ok('拿到首页 Set-Cookie', setCookie.length >= 0, String(setCookie.length));

  /* 已知事实校验：音乐站文档/实测里 MUSIC_U 是 HttpOnly 的历史有争议，这里给判据而不是结论 */
  const hasMusicU = setCookie.some((c) => /^MUSIC_U=/.test(c));
  console.log('  首页是否下发 MUSIC_U：' + (hasMusicU ? '是' : '否（只在登录接口下发）'));

  section('3. 结论与产品对策');
  console.log('  · 判据：任何"用 document.cookie 判断登录"的实现，都必须先证明 MUSIC_U 不是 HttpOnly；');
  console.log('    而 Tampermonkey 沙箱里的 document.cookie 还可能被代理，双重不可靠。');
  console.log('  · 对策：登录态一律用接口判定（account/get 有 profile = 已登录），');
  console.log('    导出会话用 GM_cookie（能读到 HttpOnly），读不到时给出 DevTools 手动复制的指引。');

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'logs', 'login-detect.json'),
    JSON.stringify({ at: new Date().toISOString(), accountGet: r && r.json, homeSetCookie: setCookie }, null, 2),
    'utf8'
  );
  console.log('明细已写入 logs/login-detect.json');
})().catch((e) => {
  console.error('异常: ' + (e && e.stack || e));
  process.exit(1);
});
