#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dist = path.join(root, 'dist');
const bundle = path.join(dist, `lawyerbuddy-skillhub-paid-v${version}`);
const archive = `${bundle}.zip`;
const paidSource = path.join(root, 'packaging', 'skillhub-paid');
const maxFiles = 200;
const supportedExtensions = new Set([
  '.md', '.py', '.js', '.mjs', '.json', '.txt', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg'
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} 执行失败`);
  return result.stdout;
}

function include(relative) {
  const value = relative.split(path.sep).join('/');
  if (value.startsWith('skills/lawyerbuddy-alipay/')
      || value.startsWith('runtime/payment/')
      || value.startsWith('services/')
      || value.startsWith('examples/')
      || value.startsWith('tests/')) return false;
  return value.startsWith('skills/')
    || value.startsWith('runtime/routing/')
    || value.startsWith('runtime/references/')
    || value.startsWith('runtime/contracts/')
    || value.startsWith('runtime/capabilities/legal-skills-chinese/skills/')
    || value === 'runtime/capabilities/legal-skills-chinese/NOTICE.md'
    || value === 'runtime/capabilities/legal-skills-chinese/SOURCE.json';
}

function collectFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, relative);
    return entry.isFile() ? [relative] : [];
  });
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function markUtf8Filenames(archivePath) {
  const bytes = fs.readFileSync(archivePath);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('无法定位 ZIP 目录');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralSignature) throw new Error('ZIP 中央目录异常');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = bytes.subarray(nameStart, nameStart + nameLength);
    if (name.some((byte) => byte > 0x7f)) {
      decoder.decode(name);
      bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 0x0800, offset + 8);
      const localOffset = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(localOffset) !== localSignature) throw new Error('ZIP 本地文件头异常');
      bytes.writeUInt16LE(bytes.readUInt16LE(localOffset + 6) | 0x0800, localOffset + 6);
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  fs.writeFileSync(archivePath, bytes);
}

try {
  fs.mkdirSync(dist, { recursive: true });
  fs.rmSync(bundle, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  fs.mkdirSync(bundle, { recursive: true });

  const listed = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).filter(include);
  for (const relative of listed) {
    const extension = path.extname(relative).toLowerCase();
    if (['.xlsx', '.xls', '.xlsm', '.docx', '.yaml', '.yml', '.pyc', '.pyo'].includes(extension)) continue;
    if (!supportedExtensions.has(extension)) throw new Error(`付费包包含未允许文件：${relative}`);
    copy(path.join(root, relative), path.join(bundle, relative));
  }

  for (const relative of collectFiles(paidSource)) {
    copy(path.join(paidSource, relative), path.join(bundle, relative));
  }

  const rootSkill = path.join(bundle, 'SKILL.md');
  const skillText = fs.readFileSync(rootSkill, 'utf8');
  const requiredSignals = [
    'HTTP 402', 'Payment-Needed', 'Payment-Proof', 'probe', 'pay', 'complete', 'ack',
    'alipay.aipay.agent.payment.verify', 'alipay.aipay.agent.fulfillment.confirm', '订单持久化与幂等'
  ];
  const missingSignals = requiredSignals.filter((signal) => !skillText.includes(signal));
  if (missingSignals.length) throw new Error(`付费根 SKILL.md 缺少检测信号：${missingSignals.join('、')}`);
  if (!skillText.startsWith('---\n') || !/^name:\s*lawyerbuddy\s*$/m.test(skillText)) {
    throw new Error('付费根 SKILL.md 元数据无效');
  }
  const paymentScript = path.join(bundle, 'scripts', 'lawyerbuddy-paid.mjs');
  if (!fs.existsSync(paymentScript)) throw new Error('付费包缺少可执行支付编排脚本');
  const paymentPackage = JSON.parse(fs.readFileSync(path.join(bundle, 'package.json'), 'utf8'));
  if (paymentPackage.peerDependencies?.['@alipay/agent-payment'] !== '1.0.23') {
    throw new Error('付费包缺少固定版本的官方买家支付依赖');
  }

  const files = collectFiles(bundle);
  if (files.length > maxFiles) throw new Error(`文件数超出 SkillHub 上限：${files.length}/${maxFiles}`);
  if (files.some((file) => path.basename(file).toUpperCase() === 'LICENSE')) throw new Error('付费包中不允许包含 LICENSE 文件');
  if (files.some((file) => !supportedExtensions.has(path.extname(file).toLowerCase()))) throw new Error('付费包包含不支持的文件类型');

  const archiveFiles = ['SKILL.md', ...files.filter((file) => file !== 'SKILL.md').sort()];
  run('zip', ['-q', archive, ...archiveFiles], { cwd: bundle });
  markUtf8Filenames(archive);
  const entries = run('unzip', ['-Z1', archive]).split(/\r?\n/).filter(Boolean);
  if (entries[0] !== 'SKILL.md') throw new Error('ZIP 第一项不是付费根 SKILL.md');

  console.log(JSON.stringify({
    folder: bundle,
    zip: archive,
    files: files.length,
    limit: maxFiles,
    root_skill: 'SKILL.md',
    package_type: 'skillhub-paid-activation',
    price: '0.01 CNY',
    resource_url: 'https://snorlaxden.fun/v1/license/activate'
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
