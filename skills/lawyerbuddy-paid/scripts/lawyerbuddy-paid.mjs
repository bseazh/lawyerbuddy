#!/usr/bin/env node

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PRIMARY_ORIGIN = 'https://snorlaxden.fun';
const COMPATIBLE_ORIGIN = 'https://134.175.154.244';
const RESOURCE_PATH = '/v1/license/activate';
const RECONCILE_PATH = '/v1/license/reconcile';
const RESOURCE_URL = `${PRIMARY_ORIGIN}${RESOURCE_PATH}`;
const STATUS_URL = 'https://snorlaxden.fun/v1/license/status';
const SESSION_URL = 'https://snorlaxden.fun/v1/license/session';
const SESSION_STATUS_URL = 'https://snorlaxden.fun/v1/license/session/status';
const SKILL_VERSION = '1.10.0';
const PAYMENT_CLI_PACKAGE = '@alipay/agent-payment';
const PAYMENT_CLI_VERSION = '1.0.28';
const PAYMENT_CLI_INSTALL = `npx -y --registry=https://registry.npmjs.org ${PAYMENT_CLI_PACKAGE}@${PAYMENT_CLI_VERSION} install-cli`;
const PENDING_ORDER_REUSE_MS = 25 * 60 * 1000;
const EXIT = {
  ERROR: 1,
  AUTHORIZATION_REQUIRED: 3,
  SERVICE_UNAVAILABLE: 4,
  BUYER_ACTION_REQUIRED: 5
};
const FEATURES = [
  'sorting', 'summarizing', 'timeline', 'similar-case-retrieval',
  'complaint-draft', 'document-drafting', 'contract-draft', 'contract-review'
];

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) fail(`无法识别的参数：${item}`);
    const key = item.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) fail(`参数 --${key} 缺少值`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function stateDirectory(value) {
  if (!value) fail('缺少 --state-dir');
  const location = path.resolve(value);
  if (location === path.parse(location).root) fail('--state-dir 不能是文件系统根目录');
  fs.mkdirSync(location, { recursive: true, mode: 0o700 });
  fs.chmodSync(location, 0o700);
  return location;
}

function readJson(file, required = true) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null;
    fail(`无法读取状态文件 ${file}：${error.message}`);
  }
}

function writeSecure(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function writeJson(file, value) {
  writeSecure(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonOutput(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* official output may wrap JSON in logs */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* not a JSON object */ }
  }
  return null;
}

function decodeBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function printBuyerAction(payload) {
  const { file, ...visible } = payload;
  writeJson(file, visible);
  console.error(JSON.stringify(visible, null, 2));
}

export function isBlockedPaymentAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('2001:db8:');
  }
  return true;
}

async function compatiblePaymentUrl() {
  try {
    const addresses = await dns.lookup(new URL(RESOURCE_URL).hostname, { all: true });
    if (addresses.some(({ address }) => isBlockedPaymentAddress(address))) {
      return `${COMPATIBLE_ORIGIN}${RESOURCE_PATH}`;
    }
  } catch {
    // The official CLI will perform its own validation and return a precise error.
  }
  return RESOURCE_URL;
}

async function verifyCompatibleOrigin() {
  let response;
  try {
    response = await fetch(`${COMPATIBLE_ORIGIN}/health`, { signal: AbortSignal.timeout(15000) });
  } catch {
    fail('支付服务暂时无法自动连接，请稍后重新调用 @lawyerbuddy-paid。', 4);
  }
  if (!response.ok) fail('支付服务兼容入口暂时不可用，请稍后重新调用 @lawyerbuddy-paid。', 4);
}

async function preparePaymentRoute(directory, state, forceCompatible = false) {
  const selected = forceCompatible ? `${COMPATIBLE_ORIGIN}${RESOURCE_PATH}` : await compatiblePaymentUrl();
  if (selected === state.resource_url) return state;
  if (selected.startsWith(COMPATIBLE_ORIGIN)) await verifyCompatibleOrigin();
  const updated = { ...state, resource_url: selected };
  writeJson(path.join(directory, 'request.json'), updated);
  return updated;
}

function clientIdentity(directory) {
  const file = path.join(directory, 'client.json');
  const existing = readJson(file, false);
  if (existing?.client_id) return existing.client_id;
  const clientId = `LBCLIENT-${crypto.randomUUID()}`;
  writeJson(file, { client_id: clientId, created_at: new Date().toISOString() });
  return clientId;
}

async function checkStoredLicense(directory) {
  const file = path.join(directory, 'license.json');
  const license = readJson(file, false);
  if (!license?.license_token) return null;
  let response;
  try {
    response = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${license.license_token}` },
      body: '{}',
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    fail(`无法检查已有授权，未创建新账单：${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.active !== true) {
    fail('本地存在授权文件，但服务端未确认有效。为避免重复收费，本次未创建新账单。');
  }
  return body;
}

async function postAuthorization(url, token, clientId) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Client-Id': clientId
      },
      body: JSON.stringify({ client_id: clientId }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } catch (error) {
    fail(`授权服务暂时无法访问，已停止本次业务操作：${error.message}`, 4);
  }
}

async function gate(directory) {
  const clientId = clientIdentity(directory);
  const sessionFile = path.join(directory, 'session.json');
  const session = readJson(sessionFile, false);
  if (session?.session_token) {
    const checked = await postAuthorization(SESSION_STATUS_URL, session.session_token, clientId);
    if (checked.response.ok && checked.body.active === true) {
      console.log(JSON.stringify({ status: 'AUTHORIZED', expires_at: checked.body.expires_at }, null, 2));
      return;
    }
    if (!['SESSION_INVALID', 'SESSION_EXPIRED'].includes(checked.body.code)) {
      fail(`会话授权检查失败：${checked.body.message || checked.response.status}`, 4);
    }
  }

  const license = readJson(path.join(directory, 'license.json'), false);
  if (!license?.license_token) {
    fail('AUTHORIZATION_REQUIRED：当前项目尚未完成 LawyerBuddy 激活。请先调用 @lawyerbuddy-paid，业务材料尚未读取。', 3);
  }
  const started = await postAuthorization(SESSION_URL, license.license_token, clientId);
  if (!started.response.ok || started.body.active !== true || !started.body.session_token) {
    fail(`AUTHORIZATION_REQUIRED：${started.body.message || '永久授权无效，请先调用 @lawyerbuddy-paid'}`, 3);
  }
  writeJson(sessionFile, {
    session_token: started.body.session_token,
    issued_at: started.body.issued_at,
    expires_at: started.body.expires_at,
    client_id: clientId
  });
  console.log(JSON.stringify({ status: 'AUTHORIZED', renewed: true, expires_at: started.body.expires_at }, null, 2));
}

function newOutTradeNo() {
  return `LBORDER_${Date.now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export function isReusablePendingOrder(state, now = Date.now()) {
  if (!state || typeof state !== 'object') return false;
  if (state.reusable === false || state.blocked_reason) return false;
  if (!state.out_trade_no || !state.resource_url || !state.created_at) return false;
  const createdAt = Date.parse(state.created_at);
  if (!Number.isFinite(createdAt) || now < createdAt || now - createdAt >= PENDING_ORDER_REUSE_MS) return false;
  const payBefore = Date.parse(state.pay_before || '');
  return !Number.isFinite(payBefore) || now < payBefore - 60 * 1000;
}

function explicitNewOrder(options) {
  const value = options['new-order'];
  if (value === undefined) return false;
  if (value !== 'true') fail('--new-order 只接受 true；仅在原订单明确不存在、关闭或过期后使用');
  return true;
}

function reusePendingOrder(directory, options) {
  if (explicitNewOrder(options)) return false;
  const state = readJson(path.join(directory, 'request.json'), false);
  const paymentFile = path.join(directory, 'payment-needed.txt');
  if (!isReusablePendingOrder(state) || !fs.existsSync(paymentFile)) return false;
  console.log(JSON.stringify({
    status: 'PAYMENT_REQUIRED',
    http_status: 402,
    reused: true,
    out_trade_no: state.out_trade_no,
    amount: state.amount,
    currency: state.currency,
    payment_needed_file: paymentFile
  }, null, 2));
  return true;
}

async function probe(directory, options) {
  const active = await checkStoredLicense(directory);
  if (active) {
    return gate(directory);
  }
  if (reusePendingOrder(directory, options)) return;

  const paymentResourceUrl = await compatiblePaymentUrl();
  if (paymentResourceUrl.startsWith(COMPATIBLE_ORIGIN)) await verifyCompatibleOrigin();
  const request = {
    client_id: clientIdentity(directory),
    skill_version: SKILL_VERSION,
    features: FEATURES
  };
  const outTradeNo = newOutTradeNo();
  let response;
  try {
    response = await fetch(paymentResourceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': outTradeNo },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    fail(`授权服务请求失败：${error.message}`);
  }
  const responseText = await response.text();
  if (response.status !== 402) fail(`授权服务预期返回 HTTP 402，实际为 ${response.status}`);
  const paymentNeeded = response.headers.get('Payment-Needed');
  if (!paymentNeeded) fail('HTTP 402 缺少 Payment-Needed 响应头');

  let responseBody;
  try { responseBody = JSON.parse(responseText); } catch { responseBody = {}; }
  if (responseBody.out_trade_no && responseBody.out_trade_no !== outTradeNo) {
    fail('服务端返回的订单号与原始请求不一致');
  }
  const bill = decodeBase64UrlJson(paymentNeeded);
  const state = {
    resource_url: paymentResourceUrl,
    method: 'POST',
    headers: ['Content-Type:application/json', `X-Out-Trade-No:${outTradeNo}`],
    body: JSON.stringify(request),
    out_trade_no: outTradeNo,
    amount: responseBody.amount || '0.01',
    currency: responseBody.currency || 'CNY',
    pay_before: bill?.protocol?.pay_before || null,
    created_at: new Date().toISOString()
  };
  writeJson(path.join(directory, 'request.json'), state);
  writeSecure(path.join(directory, 'payment-needed.txt'), paymentNeeded);
  console.log(JSON.stringify({
    status: 'PAYMENT_REQUIRED',
    http_status: 402,
    out_trade_no: outTradeNo,
    amount: state.amount,
    currency: state.currency,
    payment_needed_file: path.join(directory, 'payment-needed.txt')
  }, null, 2));
}

function requireAlipayBot() {
  const result = spawnSync('alipay-bot', ['--version'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    fail(`缺少官方支付组件。请执行 ${PAYMENT_CLI_INSTALL}，再重新调用 @lawyerbuddy-paid。`);
  }
  if (result.error || result.status !== 0) fail(result.stderr || result.error?.message || 'alipay-bot 无法运行');
}

export function classifyWalletOutput(status, stdout = '', stderr = '') {
  const text = `${stdout}\n${stderr}`;
  const parsed = parseJsonOutput(stdout) || parseJsonOutput(text);
  const code = Number(parsed?.code);
  const message = String(parsed?.message || parsed?.reason || '').trim();
  if (code === 200 && parsed?.status !== 'unbound' && parsed?.status !== 'applied_unbound') {
    return { state: 'READY', message: message || '已开启支付宝支付功能' };
  }
  if (parsed?.neverCreated === true || parsed?.status === 'unbound'
      || /未开通|尚未开启|未绑定.*钱包|wallet.*not.*bound/i.test(text)) {
    return {
      state: 'UNBOUND',
      message: message || '当前支付宝账号尚未开启 AI 支付钱包',
      neverCreated: parsed?.neverCreated === true
    };
  }
  if (parsed?.status === 'applied_unbound' || /已申请.*未绑定|待绑定授权码|binding code/i.test(text)) {
    return { state: 'APPLIED_UNBOUND', message: message || '钱包已申请，等待绑定授权码' };
  }
  if (/买家和卖家不能相同/i.test(text) || /BUYER_ID_USER_CHECK_FAILED/i.test(text)) {
    return { state: 'SELLER_ACCOUNT', message: '当前支付宝账号不能同时作为买家和收款卖家' };
  }
  if (/BINDING_CODE_REQUIRED|BINDING_CODE_INVALID_FORMAT/i.test(text)) {
    return { state: 'BINDING_CODE_REQUIRED', message: '需要支付宝页面显示的 6 位授权码' };
  }
  if (/WALLET_MIGRATION_BLOCKED/i.test(text)) {
    return { state: 'MIGRATION_BLOCKED', message: '支付宝钱包迁移被阻止' };
  }
  if (status === 0 && /已开启支付宝支付功能/.test(text)) {
    return { state: 'READY', message: '已开启支付宝支付功能' };
  }
  return { state: 'UNKNOWN', message: message || text.trim().slice(0, 400) || '无法确认买家钱包状态' };
}

function checkBuyerWallet() {
  requireAlipayBot();
  const result = spawnSync('alipay-bot', ['check-wallet', '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) fail(result.error.message, EXIT.ERROR);
  return {
    ...classifyWalletOutput(result.status ?? 1, result.stdout, result.stderr),
    exit_status: result.status ?? 1
  };
}

function walletGuidance(state) {
  if (state === 'UNBOUND') {
    return {
      code: 'BUYER_WALLET_REQUIRED',
      message: '当前支付宝账号尚未开启 AI 支付钱包。请使用买家/付款方账号，不要使用 LawyerBuddy 收款商家账号。',
      next: '在当前 Agent 直接说“开启支付宝支付功能”，按支付宝官方链接完成开通；如果已经提交过申请，不要重复申请，继续原授权流程。'
    };
  }
  if (state === 'APPLIED_UNBOUND') {
    return {
      code: 'BUYER_WALLET_BIND_REQUIRED',
      message: '钱包申请已提交，但还没有绑定。',
      next: '向用户索取支付宝页面显示的 6 位授权码并完成绑定；提交后运行 wallet 检查状态，不要重复提交授权码或重新申请。'
    };
  }
  if (state === 'BINDING_CODE_REQUIRED') {
    return {
      code: 'BUYER_WALLET_BIND_REQUIRED',
      message: '需要支付宝页面显示的 6 位授权码才能完成绑定。',
      next: '取得授权码后完成绑定，再运行 wallet 检查；不要重新 apply-wallet。'
    };
  }
  if (state === 'SELLER_ACCOUNT') {
    return {
      code: 'BUYER_SELLER_SAME',
      message: '当前支付宝账号就是 LawyerBuddy 收款商家账号，不能作为买家付款。',
      next: '换用另一个支付宝账号作为买家并开启支付功能，然后重新运行 probe。不要重复使用当前订单付款。'
    };
  }
  if (state === 'MIGRATION_BLOCKED') {
    return {
      code: 'WALLET_MIGRATION_BLOCKED',
      message: '支付宝阻止了当前钱包迁移。',
      next: '保留提示和订单号，使用支付宝官方钱包管理或问题反馈流程；不要删除本地凭证、修改设备标识或反复切换代理。'
    };
  }
  return {
    code: 'BUYER_WALLET_CHECK_FAILED',
    message: '暂时无法确认买家钱包状态，本次未发起付款。',
    next: '检查网络后重新运行 wallet；不要直接重复下单或反复安装支付工具。'
  };
}

function wallet(directory, options) {
  const checked = checkBuyerWallet();
  writeJson(path.join(directory, 'wallet-status.json'), {
    checked_at: new Date().toISOString(),
    ...checked
  });
  if (checked.state === 'READY') {
    console.log(JSON.stringify({
      status: 'BUYER_WALLET_READY',
      message: checked.message
    }, null, 2));
    return;
  }
  const guidance = walletGuidance(checked.state);
  if (options.apply === 'true' && checked.state === 'UNBOUND' && checked.neverCreated !== false) {
    const applied = spawnSync('alipay-bot', [
      'apply-wallet',
      '--agent-name', options['agent-name'] || 'LawyerBuddy',
      '--json'
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (applied.error) fail(applied.error.message, EXIT.ERROR);
    const combined = `${applied.stdout || ''}\n${applied.stderr || ''}`;
    const parsed = parseJsonOutput(applied.stdout) || parseJsonOutput(combined) || {};
    writeJson(path.join(directory, 'wallet-apply.json'), parsed);
    writeSecure(path.join(directory, 'wallet-apply-output.txt'), combined);
    console.log(JSON.stringify({
      status: applied.status === 0 ? 'WALLET_APPLY_REQUIRED' : 'WALLET_APPLY_FAILED',
      authorization_url: parsed.authorization_url || parsed.authorizationUrl || parsed.url || parsed.apply_url || '',
      message: applied.status === 0
        ? '请原样打开支付宝官方链接完成开通；已经申请过时不要重复申请。'
        : '支付宝钱包申请没有成功；保留官方输出，不要重复申请。',
      raw_output: combined.trim()
    }, null, 2));
    process.exitCode = applied.status === 0 ? EXIT.BUYER_ACTION_REQUIRED : EXIT.ERROR;
    return;
  }
  printBuyerAction({
    file: path.join(directory, 'wallet-guidance.json'),
    status: 'BUYER_ACTION_REQUIRED',
    ...guidance
  });
  process.exitCode = EXIT.BUYER_ACTION_REQUIRED;
}

function requireBuyerWallet() {
  const checked = checkBuyerWallet();
  if (checked.state === 'READY') return;
  const guidance = walletGuidance(checked.state);
  fail(`${guidance.code}：${guidance.message} ${guidance.next}`, EXIT.BUYER_ACTION_REQUIRED);
}

function requestArgs(state) {
  return [
    '--resource-url', state.resource_url,
    '--method', state.method,
    '--data', state.body,
    ...state.headers.flatMap((header) => ['--header', header])
  ];
}

function runAlipay(args, directory, outputName) {
  requireAlipayBot();
  const result = spawnSync('alipay-bot', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) fail(result.error.message);
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  writeSecure(path.join(directory, outputName), combined);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1, combined };
}

function isProxyTargetBlocked(result) {
  return result.combined.includes('PROXY_TARGET_BLOCKED');
}

const PAYMENT_ERROR_RULES = [
  {
    code: 'BUYER_SELLER_SAME',
    pattern: /买家和卖家不能相同|BUYER_ID_USER_CHECK_FAILED/i,
    buyerAction: true,
    blockOrder: true,
    message: '当前付款账号就是 LawyerBuddy 收款商家账号，支付宝不允许同一账号收款和付款。',
    next: '换用另一个支付宝账号作为买家并开启支付功能，然后重新运行 probe。当前订单不能再用于付款。'
  },
  {
    code: 'WALLET_MIGRATION_BLOCKED',
    pattern: /WALLET_MIGRATION_BLOCKED/i,
    buyerAction: true,
    message: '支付宝阻止了当前钱包迁移。',
    next: '保留提示和订单号，使用支付宝官方钱包管理或问题反馈流程；不要删除本地凭证、修改设备标识或反复切换代理。'
  },
  {
    code: 'BUYER_WALLET_BIND_REQUIRED',
    pattern: /BINDING_CODE_REQUIRED|BINDING_CODE_INVALID_FORMAT|ENROLLMENT_CODE_REQUIRED/i,
    buyerAction: true,
    message: '钱包还没有完成绑定，需要支付宝页面显示的 6 位授权码。',
    next: '取得授权码后完成绑定，再运行 wallet 检查；不要重复提交授权码，也不要重新 apply-wallet。'
  },
  {
    code: 'WALLET_ALREADY_BOUND',
    pattern: /WALLET_ALREADY_BOUND/i,
    buyerAction: true,
    message: '当前支付宝钱包已经绑定。',
    next: '直接运行 wallet 检查状态并继续支付；不要重复申请或重复绑定。'
  },
  {
    code: 'USER_LIMITED',
    pattern: /USER_LIMITED/i,
    buyerAction: true,
    message: '当前买家支付宝账号受到限制。',
    next: '换用另一个可正常支付的买家账号，或按支付宝页面提示处理；不要重复提交同一笔付款。'
  },
  {
    code: 'BUYER_NOT_ALLOWED',
    pattern: /USER_NOT_ALLOW|USER_NOT_IN_WHITELIST|PERM_LIMIT_FAILED|SECURITY_CHECK_FAILED|EXMERCHANT_TYPE_NOT_SUPPORTED/i,
    buyerAction: true,
    message: '支付宝侧拒绝了当前买家或商户配置。',
    next: '停止重复付款，保留订单号和完整错误码；按支付宝官方问题反馈流程处理，不要修改客户端来绕过校验。'
  },
  {
    code: 'PAYMENT_CONFIG_MISMATCH',
    pattern: /SERVICE_SELLER_ID_MISMATCH|SERVICE_ID_VALIDATE_FAILED|SERVICE_ID_IS_EMPTY|SERVICE_PRICE_MISMATCH|IDEMPOTENT_SELLER_MISMATCH|IDEMPOTENT_AMOUNT_MISMATCH|AMOUNT_MISMATCH/i,
    buyerAction: false,
    message: '订单金额、服务或收款商家配置与支付宝侧不一致。',
    next: '停止付款，保留订单号并检查服务端支付宝配置；不要修改客户端金额或重复下单。'
  },
  {
    code: 'PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE',
    pattern: /PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE/i,
    buyerAction: false,
    recoverable: true,
    message: '当前环境没有可用的支付宝查询凭证。',
    next: '不要再次付款。直接运行 recover 让服务端按商户订单号和交易号向支付宝对账；仍失败时保留订单号和交易号联系支持。'
  },
  {
    code: 'PAYMENT_QUERY_UNAVAILABLE',
    pattern: /SYSTEM_ERROR|查询支付凭证失败/i,
    buyerAction: false,
    recoverable: true,
    message: '支付宝买家侧暂时无法查询这笔付款凭证。',
    next: '不要再次付款，也不要用 LBORDER_ 商户订单号反复查询；直接运行 recover 让服务端按商户订单号和交易号向支付宝对账。'
  },
  {
    code: 'PAYMENT_ORDER_MISMATCH',
    pattern: /PAYMENT_QUERY_ORDER_MISMATCH|RESOURCE_ORDER_MISMATCH_AFTER_PAYMENT|RESOURCE_TRADE_MISMATCH_AFTER_PAYMENT|PAYMENT_PROOF_BUYER_MISMATCH/i,
    buyerAction: false,
    message: '付款已完成，但订单号、交易号或买家与原始请求不一致。',
    next: '不要再次付款。先运行 complete 查询原订单；仍不一致时保留订单号和交易号，按支付宝官方反馈流程处理。'
  },
  {
    code: 'PAYMENT_OUTCOME_UNKNOWN',
    pattern: /RESOURCE_OUTCOME_UNKNOWN|PAYMENT_COMPLETED_RESOURCE_NOT_DELIVERED|RESOURCE_CREDENTIALS_MISSING_AFTER_PAYMENT|RESOURCE_URL_MISSING_AFTER_PAYMENT|PAYMENT_PROOF_QUERY_RESPONSE_INVALID/i,
    buyerAction: false,
    message: '付款可能已完成，但授权结果尚未确认或交付。',
    next: '不要再次付款。运行 complete 查询原订单并重试同一请求；仍失败时保留订单号联系支持。'
  },
  {
    code: 'TRADE_ALREADY_PAID',
    pattern: /TRADE_ALREADY_PAID|TRADE_HAS_PAID|TRADE_ALREADY_FINISHED|PAYMENT_PROCESSING|PAYMENT_PENDING/i,
    buyerAction: false,
    message: '原订单已经付款或正在处理中。',
    next: '不要再次付款。运行 complete 查询原订单并领取永久授权。'
  },
  {
    code: 'TRADE_QUERY_FIRST',
    pattern: /TRADE_STATUS_NOT_ALLOW_GENERATE_PROOF|TRADE_STATUS_CLOSED|TRADE_STATUS_UNPAID|TRADE_NOT_FOUND|REQUEST_EXPIRED|TRADE_ALIAS_EXPIRED|PAYMENT_ALIAS_EXPIRED|TRADE_ALIAS_NOT_FOUND|PAYMENT_ALIAS_NOT_FOUND/i,
    buyerAction: false,
    message: '当前订单不能继续生成支付凭证，可能需要先查询原订单。',
    next: '先运行 complete 查询原订单。只有支付宝明确返回订单不存在、已关闭或已过期，并且用户同意重新下单时，才运行 probe --new-order true。'
  },
  {
    code: 'FULFILLMENT_RETRY',
    pattern: /FULFILLMENT_CONFIRM_FAILED|Payment-Proof 验证失败/i,
    buyerAction: false,
    message: '付款已完成，但授权交付或履约确认暂时失败。',
    next: '不要再次付款。使用同一订单和同一 Payment-Proof 重试 complete；仍失败时保留订单号和交易号联系支持。'
  },
  {
    code: 'SERVER_ORDER_MISSING',
    pattern: /ORDER_NOT_FOUND|BIZ_ORDER_NOT_FOUND/i,
    buyerAction: false,
    message: '服务端未找到原订单。',
    next: '先确认支付宝是否已经扣款；只有确认订单不存在或已关闭，并且用户同意后，才重新 probe 下单。'
  },
  {
    code: 'SERVER_TEMPORARY_ERROR',
    pattern: /INTEGRATION_ERROR|授权接口暂不可用|授权结果未生成/i,
    buyerAction: false,
    message: '授权服务暂时异常，无法确认本次交付。',
    next: '不要再次付款。稍后重新运行 complete 查询原订单；仍失败时保留订单号联系支持。'
  },
  {
    code: 'PAYMENT_TIMEOUT',
    pattern: /PAY_TIMEOUT|CLIENT_TIMEOUT|PROXY_PAYMENT_RESULT_UNKNOWN|PAY_RESULT_QUERY_FAILED|CASHIER_QUERY_FAILED|PAYMENT_QUERY_FAILED/i,
    buyerAction: false,
    message: '支付结果暂时无法确认。',
    next: '不要直接再次付款。先运行 complete 查询原订单；网络恢复后仍失败再按支付宝官方反馈流程处理。'
  },
  {
    code: 'PAYMENT_FAILED',
    pattern: /PAYMENT_FAILED|TRADE_PROGRESS_FAILED|TR_PAY_FAILED|PAY_SUBMIT_FAILED|SUBMIT_PAYMENT_FAILED|CHECK_AND_PAY_ORDER_FAILED|RESOURCE_DELIVERY_FAILED|RESOURCE_REQUEST_FAILED/i,
    buyerAction: false,
    message: '本次付款或资源交付没有成功。',
    next: '先运行 complete 查询原订单；确认未付款后再决定是否重试，不要重复创建新订单。'
  },
  {
    code: 'PROXY_TARGET_BLOCKED',
    pattern: /PROXY_TARGET_BLOCKED|PROXY_DNS_RESOLVE_FAILED|PROXY_REQUEST_FAILED/i,
    buyerAction: false,
    message: '支付服务的网络入口被本机代理拦截。',
    next: '客户端已尝试自动切换兼容入口；仍失败时稍后重新调用 @lawyerbuddy-paid。不要关闭 TLS 或 SSRF 校验。'
  }
];

export function classifyPaymentOutput(output) {
  const text = String(output || '');
  if (!text.trim()) return null;
  const rule = PAYMENT_ERROR_RULES.find((candidate) => candidate.pattern.test(text));
  if (!rule) return null;
  return {
    code: rule.code,
    buyerAction: rule.buyerAction === true,
    blockOrder: rule.blockOrder === true,
    recoverable: rule.recoverable === true,
    message: rule.message,
    next: rule.next
  };
}

function recordPaymentError(directory, failure, exitStatus) {
  const record = {
    at: new Date().toISOString(),
    status: failure.buyerAction ? 'PAYMENT_ACTION_REQUIRED' : 'PAYMENT_NOT_COMPLETED',
    code: failure.code,
    message: failure.message,
    next: failure.next,
    exit_status: exitStatus
  };
  writeJson(path.join(directory, 'payment-error.json'), record);
  if (failure.blockOrder) {
    const file = path.join(directory, 'request.json');
    const state = readJson(file, false);
    if (state) {
      writeJson(file, {
        ...state,
        reusable: false,
        blocked_reason: failure.code,
        blocked_at: new Date().toISOString()
      });
    }
  }
  printBuyerAction({ file: path.join(directory, 'payment-error.json'), ...record });
  if (failure.buyerAction) return EXIT.BUYER_ACTION_REQUIRED;
  if (['PROXY_TARGET_BLOCKED', 'SERVER_TEMPORARY_ERROR'].includes(failure.code)) {
    return EXIT.SERVICE_UNAVAILABLE;
  }
  return EXIT.ERROR;
}

export function resolveSessionId(directory, options) {
  const supplied = String(options['session-id'] || '').trim();
  if (supplied) return supplied;
  for (const name of [
    'OPENCLAW_SESSION_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID',
    'OPENCODE_SESSION_ID', 'AGENT_SESSION_ID', 'SESSION_ID'
  ]) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  const file = path.join(directory, 'session-id.txt');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* first payment in this project */ }
  const generated = `LBSESSION-${crypto.randomUUID()}`;
  writeSecure(file, `${generated}\n`);
  return generated;
}

async function pay(directory, options) {
  const sessionId = resolveSessionId(directory, options);
  if (!options['intent-summary']?.startsWith('原始请求：')) fail('--intent-summary 必须说明原始业务目的');
  const active = await checkStoredLicense(directory);
  if (active) {
    console.log(JSON.stringify({
      status: 'AUTHORIZED',
      message: '已有有效永久授权，本次不再发起付款。',
      license: active
    }, null, 2));
    return;
  }
  requireBuyerWallet();
  let state = readJson(path.join(directory, 'request.json'));
  if (state.reusable === false || state.blocked_reason) {
    fail(`当前订单已标记为不可复用（${state.blocked_reason || 'unknown'}）。请先运行 probe 获取新订单，不要继续支付旧订单。`, EXIT.BUYER_ACTION_REQUIRED);
  }
  state = await preparePaymentRoute(directory, state);
  const paymentFile = path.join(directory, 'payment-needed.txt');
  if (!fs.existsSync(paymentFile)) fail('缺少本轮 Payment-Needed 文件，请先执行 probe');
  let result = runAlipay([
    '402-buyer-pay',
    '--session-id', sessionId,
    '--file', paymentFile,
    ...requestArgs(state),
    '--intent-summary', options['intent-summary']
  ], directory, 'payment-output.txt');
  if (isProxyTargetBlocked(result) && state.resource_url === RESOURCE_URL) {
    state = await preparePaymentRoute(directory, state, true);
    result = runAlipay([
      '402-buyer-pay',
      '--session-id', sessionId,
      '--file', paymentFile,
      ...requestArgs(state),
      '--intent-summary', options['intent-summary']
    ], directory, 'payment-output.txt');
  }
  const explicitFailure = /"success"\s*:\s*false|"errorCode"\s*:|买家和卖家不能相同|TRADE_PROGRESS_FAILED/.test(result.combined);
  if (result.status !== 0 || explicitFailure) {
    const failure = classifyPaymentOutput(result.combined);
    if (failure) {
      process.exitCode = recordPaymentError(directory, failure, result.status);
      return;
    }
  }
  process.exitCode = result.status;
}

function extractLicenseToken(output) {
  const normalized = output.replaceAll('\\"', '"');
  const match = normalized.match(/["']license_token["']\s*:\s*["']([^"'\s]+)["']/i)
    || normalized.match(/license_token\s*[=:]\s*([^\s]+)/i);
  return match?.[1] || '';
}

export function extractTradeNo(output) {
  const text = String(output || '').replaceAll('*', '');
  const labeled = text.match(/(?:trade[_ -]?no|tradeNo|交易号)["'\s]*[:：=]\s*["']?(\d{16,64})/i);
  if (labeled) return labeled[1];
  const parsed = parseJsonOutput(text);
  const value = parsed?.trade_no || parsed?.tradeNo || parsed?.protocol?.trade_no || parsed?.data?.trade_no;
  return value ? String(value).trim() : '';
}

export function parsePaymentQuery(options, paymentOutput = '') {
  const shakeNo = String(options['out-shake-no'] || '').trim();
  const tradeNo = String(options['trade-no'] || '').trim();
  if (shakeNo && !/^LBORDER_/i.test(shakeNo)) return ['--out-shake-no', shakeNo];
  if (tradeNo && !/^LBORDER_/i.test(tradeNo)) return ['--trade-no', tradeNo];
  const text = String(paymentOutput).replaceAll('*', '');
  const shake = text.match(/(?:out[_ -]?shake[_ -]?no|outShakeNo|query[_ -]?no|查询单号)["'\s]*[:：=]\s*["']?([A-Za-z0-9_-]{8,})/i);
  if (shake && !/^LBORDER_/i.test(shake[1])) return ['--out-shake-no', shake[1]];
  const trade = extractTradeNo(text);
  if (trade) return ['--trade-no', trade];
  return null;
}

export function resolvePaymentQuery(options, paymentOutput = '') {
  const args = parsePaymentQuery(options, paymentOutput);
  if (args) return args;
  const shakeNo = String(options['out-shake-no'] || '').trim();
  const tradeNo = String(options['trade-no'] || '').trim();
  if (/^LBORDER_/i.test(shakeNo) || /^LBORDER_/i.test(tradeNo)) {
    fail('LBORDER_ 开头的是 LawyerBuddy 商户订单号，不能用于支付宝查询；请改用 pay 输出中的查询单号或交易号，或不带参数直接运行 complete。');
  }
  fail('未找到可查询的支付宝单号。请先运行 pay 并保留官方输出；如已付款，请把官方结果中的“交易号”通过 --trade-no 传入，不要使用 LBORDER_ 商户订单号。');
}

async function saveActivation(directory, state, token, extra = {}) {
  let response;
  try {
    response = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    fail(`授权已返回，但暂时无法在线确认：${error.message}。请稍后重新运行 complete，不要再次付款。`, EXIT.SERVICE_UNAVAILABLE);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.active !== true) {
    fail('支付宝付款已完成，但服务端未确认授权有效。请保留订单号并重新运行 complete，不要再次付款。', EXIT.ERROR);
  }
  writeJson(path.join(directory, 'license.json'), { license_token: token, ...body, saved_at: new Date().toISOString() });
  writeJson(path.join(directory, 'request.json'), {
    ...state,
    reusable: false,
    completed: true,
    completed_at: new Date().toISOString(),
    ...extra
  });
  try {
    fs.renameSync(
      path.join(directory, 'payment-needed.txt'),
      path.join(directory, 'payment-needed.completed.txt')
    );
  } catch { /* legacy state without a pending bill */ }
  fs.rmSync(path.join(directory, 'payment-error.json'), { force: true });
  await gate(directory);
}

function recoveryFailure(body, status, originalCode) {
  const code = String(body?.code || (status === 404 ? 'RECONCILE_NOT_AVAILABLE' : `HTTP_${status}`));
  const guidance = {
    TRADE_NOT_PAID: {
      message: '支付宝侧尚未确认这笔订单付款成功。',
      next: '先核对支付宝账单。如果账单已扣款，等待 1—2 分钟后再次运行 recover；不要重新付款。'
    },
    TRADE_NOT_FOUND: {
      message: '支付宝侧暂时没有查到这笔交易。',
      next: '核对订单号和交易号；刚付款时可等待 1—2 分钟后再次运行 recover，不要重新付款。'
    },
    TRADE_QUERY_FAILED: {
      message: '服务端暂时无法向支付宝查询这笔交易。',
      next: '稍后再次运行 recover，不要重新付款；连续失败时保留订单号和交易号联系支持。'
    },
    TRADE_QUERY_INCOMPLETE: {
      message: '支付宝交易查询结果不完整。',
      next: '不要重新付款。稍后再次运行 recover，并保留订单号和交易号联系支持。'
    },
    ORDER_NOT_FOUND: {
      message: '服务端没有找到这个商户订单。',
      next: '确认状态目录和订单号是否正确；不要重新下单或付款。'
    },
    ORDER_REQUEST_MISMATCH: {
      message: '订单与当前客户端或功能列表不匹配。',
      next: '使用创建该订单时的同一状态目录和同一客户端；不要重新付款。'
    },
    ORDER_NOT_PAYABLE: {
      message: '该订单已失效或已退款，不能用于恢复授权。',
      next: '保留订单号和交易号联系支持，不要自行重复付款。'
    },
    TRADE_ORDER_MISMATCH: {
      message: '支付宝交易对应的商户订单号与本地订单不一致。',
      next: '不要重新付款。保留订单号和交易号联系支持核对。'
    },
    TRADE_AMOUNT_MISMATCH: {
      message: '支付宝交易金额与订单金额不一致。',
      next: '不要重新付款。保留订单号和交易号联系支持核对。'
    },
    TRADE_SELLER_MISMATCH: {
      message: '支付宝交易的收款商家与当前服务配置不一致。',
      next: '不要重新付款。保留订单号和交易号联系支持核对。'
    },
    TRADE_NO_MISMATCH: {
      message: '提交的交易号与支付宝查询结果不一致。',
      next: '使用 pay 输出中的原始交易号重试 recover；不要重新付款。'
    },
    INVALID_TRADE_NO: {
      message: '交易号格式不正确。',
      next: '使用 pay 输出中以数字开头的支付宝交易号重试；不要使用 LBORDER_ 商户订单号。'
    },
    RECONCILE_DISABLED: {
      message: '当前服务端尚未启用交易对账恢复。',
      next: '需要先部署支持 /v1/license/reconcile 的服务端版本；保留订单号和交易号，不要重新付款。'
    },
    RECONCILE_NOT_AVAILABLE: {
      message: '当前服务端还没有交易对账恢复接口。',
      next: '需要先部署支持 /v1/license/reconcile 的服务端版本；保留订单号和交易号，不要重新付款。'
    },
    INTEGRATION_ERROR: {
      message: '服务端交易对账接口暂时异常。',
      next: '稍后再次运行 recover，不要重新付款；连续失败时保留订单号和交易号联系支持。'
    }
  }[code] || {
    message: body?.message || '服务端交易对账没有成功。',
    next: '不要重新付款。保留订单号和交易号，稍后重试 recover 或联系支持。'
  };
  return { code, ...guidance, original_code: originalCode || null };
}

async function recover(directory, options, context = {}) {
  const state = readJson(path.join(directory, 'request.json'));
  const paymentOutputFile = path.join(directory, 'payment-output.txt');
  const paymentOutput = fs.existsSync(paymentOutputFile) ? fs.readFileSync(paymentOutputFile, 'utf8') : '';
  const suppliedTradeNo = String(options['trade-no'] || '').trim();
  const tradeNo = /^\d{16,64}$/.test(suppliedTradeNo) ? suppliedTradeNo : extractTradeNo(paymentOutput);
  if (!tradeNo) {
    const failure = {
      code: 'TRADE_NO_REQUIRED',
      message: '没有找到可用于服务端对账的支付宝交易号。',
      next: '从 pay 输出中复制“交易号”，运行 recover --trade-no <交易号>；不要使用 LBORDER_ 商户订单号，也不要重新付款。'
    };
    const record = {
      at: new Date().toISOString(),
      status: 'PAYMENT_NOT_COMPLETED',
      ...failure,
      original_code: context.originalCode || null
    };
    writeJson(path.join(directory, 'payment-error.json'), record);
    printBuyerAction({ file: path.join(directory, 'payment-error.json'), ...record });
    process.exitCode = EXIT.ERROR;
    return false;
  }

  const active = await checkStoredLicense(directory);
  if (active) {
    console.log(JSON.stringify({ status: 'AUTHORIZED', message: '已有有效永久授权，无需再次对账。', license: active }, null, 2));
    return true;
  }

  let requestBody;
  try {
    requestBody = JSON.parse(state.body);
  } catch {
    fail('本地 request.json 中的原始请求已损坏，无法对账；请保留订单号和交易号联系支持。', EXIT.ERROR);
  }
  const payload = {
    ...requestBody,
    out_trade_no: state.out_trade_no,
    trade_no: tradeNo
  };
  const bases = [];
  try {
    const origin = new URL(state.resource_url).origin;
    if (origin) bases.push(origin);
  } catch { /* use defaults */ }
  for (const origin of [PRIMARY_ORIGIN, COMPATIBLE_ORIGIN]) {
    if (!bases.includes(origin)) bases.push(origin);
  }

  let response;
  let body = {};
  for (const origin of bases) {
    try {
      response = await fetch(`${origin}${RECONCILE_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Out-Trade-No': state.out_trade_no,
          'X-Trade-No': tradeNo
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });
      body = await response.json().catch(() => ({}));
      break;
    } catch { /* try the next compatible origin */ }
  }

  if (!response) {
    const failure = {
      code: 'RECONCILE_NETWORK_ERROR',
      message: '暂时无法连接授权服务进行交易对账。',
      next: '稍后再次运行 recover，不要重新付款；保留订单号和交易号。',
      original_code: context.originalCode || null
    };
    const record = { at: new Date().toISOString(), status: 'PAYMENT_NOT_COMPLETED', ...failure };
    writeJson(path.join(directory, 'payment-error.json'), record);
    printBuyerAction({ file: path.join(directory, 'payment-error.json'), ...record });
    process.exitCode = EXIT.SERVICE_UNAVAILABLE;
    return false;
  }

  if (!response.ok || !body.license_token) {
    const failure = recoveryFailure(body, response.status, context.originalCode);
    const record = {
      at: new Date().toISOString(),
      status: 'PAYMENT_NOT_COMPLETED',
      http_status: response.status,
      ...failure
    };
    writeJson(path.join(directory, 'payment-error.json'), record);
    printBuyerAction({ file: path.join(directory, 'payment-error.json'), ...record });
    process.exitCode = ['TRADE_QUERY_FAILED', 'RECONCILE_NOT_AVAILABLE', 'RECONCILE_DISABLED', 'INTEGRATION_ERROR']
      .includes(failure.code) ? EXIT.SERVICE_UNAVAILABLE : EXIT.ERROR;
    return false;
  }

  await saveActivation(directory, state, body.license_token, {
    recovered: true,
    recovered_at: new Date().toISOString(),
    recovery_trade_no: tradeNo
  });
  return true;
}

async function complete(directory, options) {
  const paymentOutputFile = path.join(directory, 'payment-output.txt');
  const paymentOutput = fs.existsSync(paymentOutputFile) ? fs.readFileSync(paymentOutputFile, 'utf8') : '';
  const suppliedTradeNo = String(options['trade-no'] || '').trim();
  const tradeNo = /^\d{16,64}$/.test(suppliedTradeNo) ? suppliedTradeNo : extractTradeNo(paymentOutput);
  const queryArgs = parsePaymentQuery(options, paymentOutput);
  let state = readJson(path.join(directory, 'request.json'));
  state = await preparePaymentRoute(directory, state);
  let result = null;
  if (queryArgs) {
    result = runAlipay([
      '402-query-payment-status',
      ...queryArgs,
      ...requestArgs(state)
    ], directory, 'completion-output.txt');
    if (isProxyTargetBlocked(result) && state.resource_url === RESOURCE_URL) {
      state = await preparePaymentRoute(directory, state, true);
      result = runAlipay([
        '402-query-payment-status',
        ...queryArgs,
        ...requestArgs(state)
      ], directory, 'completion-output.txt');
    }
    const token = extractLicenseToken(result.combined);
    if (result.status === 0 && token) {
      await saveActivation(directory, state, token);
      return;
    }
  }

  const failure = result ? classifyPaymentOutput(result.combined) : null;
  if (tradeNo && (!failure || (failure.recoverable && !failure.buyerAction))) {
    console.error('买家侧查询没有取得授权，改用服务端交易对账恢复（不会再次付款）...');
    const recovered = await recover(directory, { 'trade-no': tradeNo }, { originalCode: failure?.code });
    if (recovered) return;
    return;
  }
  if (failure) {
    process.exitCode = recordPaymentError(directory, failure, result?.status ?? 1);
    return;
  }
  const missing = {
    code: 'PAYMENT_QUERY_IDENTIFIER_MISSING',
    message: '没有找到可查询的支付宝查询单号或交易号。',
    next: '从 pay 输出中复制“交易号”，运行 complete --trade-no <交易号> 或 recover --trade-no <交易号>；不要使用 LBORDER_ 商户订单号，也不要重新付款。'
  };
  process.exitCode = recordPaymentError(directory, missing, 1);
}

function ack(options) {
  if (!options['trade-no']) fail('缺少 --trade-no');
  requireAlipayBot();
  const result = spawnSync('alipay-bot', ['402-buyer-fulfillment-ack', '--trade-no', options['trade-no']], { stdio: 'inherit' });
  if (result.error) fail(result.error.message);
  process.exitCode = result.status ?? 1;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'ack') return ack(options);
  if (!['probe', 'pay', 'complete', 'recover', 'status', 'gate', 'wallet'].includes(command)) {
    fail('用法：lawyerbuddy-paid.mjs probe|wallet|pay|complete|recover|status|gate|ack [参数]');
  }
  const directory = stateDirectory(options['state-dir']);
  if (command === 'gate') return gate(directory);
  if (command === 'wallet') return wallet(directory, options);
  if (command === 'recover') return recover(directory, options);
  if (command === 'probe' || command === 'status') {
    const active = command === 'status' ? await checkStoredLicense(directory) : null;
    if (command === 'status') {
      if (!active) fail('尚未保存授权');
      console.log(JSON.stringify({ status: 'ACTIVE', license: active }, null, 2));
      return;
    }
    return probe(directory, options);
  }
  if (command === 'pay') return pay(directory, options);
  return complete(directory, options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => fail(error.stack || error.message));
}
