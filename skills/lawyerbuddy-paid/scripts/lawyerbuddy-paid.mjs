#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RESOURCE_URL = 'https://snorlaxden.fun/v1/license/activate';
const STATUS_URL = 'https://snorlaxden.fun/v1/license/status';
const SESSION_URL = 'https://snorlaxden.fun/v1/license/session';
const SESSION_STATUS_URL = 'https://snorlaxden.fun/v1/license/session/status';
const SKILL_VERSION = '1.9.3';
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

async function probe(directory) {
  const active = await checkStoredLicense(directory);
  if (active) {
    return gate(directory);
  }

  const request = {
    client_id: clientIdentity(directory),
    skill_version: SKILL_VERSION,
    features: FEATURES
  };
  const outTradeNo = newOutTradeNo();
  let response;
  try {
    response = await fetch(RESOURCE_URL, {
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
  const state = {
    resource_url: RESOURCE_URL,
    method: 'POST',
    headers: ['Content-Type:application/json', `X-Out-Trade-No:${outTradeNo}`],
    body: JSON.stringify(request),
    out_trade_no: outTradeNo,
    amount: responseBody.amount || '0.01',
    currency: responseBody.currency || 'CNY',
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
    fail('缺少官方 alipay-bot。请先运行 npx -y @alipay/alipay-aipay@latest install，再重新调用 @lawyerbuddy-paid。');
  }
  if (result.error || result.status !== 0) fail(result.stderr || result.error?.message || 'alipay-bot 无法运行');
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

function pay(directory, options) {
  if (!options['session-id']) fail('缺少当前运行时的 --session-id');
  if (!options['intent-summary']?.startsWith('原始请求：')) fail('--intent-summary 必须说明原始业务目的');
  const state = readJson(path.join(directory, 'request.json'));
  const paymentFile = path.join(directory, 'payment-needed.txt');
  if (!fs.existsSync(paymentFile)) fail('缺少本轮 Payment-Needed 文件，请先执行 probe');
  const result = runAlipay([
    '402-buyer-pay',
    '--session-id', options['session-id'],
    '--file', paymentFile,
    ...requestArgs(state),
    '--intent-summary', options['intent-summary']
  ], directory, 'payment-output.txt');
  process.exitCode = result.status;
}

function extractLicenseToken(output) {
  const normalized = output.replaceAll('\\"', '"');
  const match = normalized.match(/["']license_token["']\s*:\s*["']([^"'\s]+)["']/i)
    || normalized.match(/license_token\s*[=:]\s*([^\s]+)/i);
  return match?.[1] || '';
}

async function complete(directory, options) {
  if (!options['out-shake-no']) fail('缺少 --out-shake-no；请使用 pay 输出中的订单号或查询单号');
  const state = readJson(path.join(directory, 'request.json'));
  const result = runAlipay([
    '402-query-payment-status',
    '--out-shake-no', options['out-shake-no'],
    ...requestArgs(state)
  ], directory, 'completion-output.txt');
  if (result.status === 0) {
    const token = extractLicenseToken(result.combined);
    if (token) {
      const response = await fetch(STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
        signal: AbortSignal.timeout(30000)
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.active === true) {
        writeJson(path.join(directory, 'license.json'), { license_token: token, ...body, saved_at: new Date().toISOString() });
        await gate(directory);
      }
    }
  }
  process.exitCode = result.status;
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
  if (!['probe', 'pay', 'complete', 'status', 'gate'].includes(command)) {
    fail('用法：lawyerbuddy-paid.mjs probe|pay|complete|status|gate|ack [参数]');
  }
  const directory = stateDirectory(options['state-dir']);
  if (command === 'gate') return gate(directory);
  if (command === 'probe' || command === 'status') {
    const active = command === 'status' ? await checkStoredLicense(directory) : null;
    if (command === 'status') {
      if (!active) fail('尚未保存授权');
      console.log(JSON.stringify({ status: 'ACTIVE', license: active }, null, 2));
      return;
    }
    return probe(directory);
  }
  if (command === 'pay') return pay(directory, options);
  return complete(directory, options);
}

main().catch((error) => fail(error.stack || error.message));
