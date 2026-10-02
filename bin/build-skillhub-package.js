#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const dist = path.join(root, "dist");
const bundle = path.join(dist, `lawyerbuddy-skillhub-v${version}`);
const archive = `${bundle}.zip`;
const maxFiles = 200;
const supportedExtensions = new Set([
  ".md", ".py", ".js", ".json", ".txt", ".html", ".css", ".svg", ".png", ".jpg", ".jpeg"
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || `${command} 执行失败`);
  }
  return result.stdout;
}

function include(relative) {
  const value = relative.split(path.sep).join("/");
  return value === "SKILL.md"
    || value === "README.md"
    || value === "INSTALL.md"
    || value.startsWith("docs/")
    || value.startsWith("skills/")
    || value.startsWith("runtime/routing/")
    || value.startsWith("runtime/references/")
    || value.startsWith("runtime/contracts/")
    || value.startsWith("runtime/payment/")
    || value.startsWith("runtime/capabilities/legal-skills-chinese/skills/")
    || value === "runtime/capabilities/legal-skills-chinese/NOTICE.md"
    || value === "runtime/capabilities/legal-skills-chinese/SOURCE.json";
}

function collectFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, relative);
    return entry.isFile() ? [relative] : [];
  });
}

function markUtf8Filenames(archivePath) {
  const bytes = fs.readFileSync(archivePath);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("无法定位 ZIP 目录，不能验证文件名编码");

  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  let offset = centralOffset;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralSignature) throw new Error("ZIP 中央目录结构异常");
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const hasNonAscii = nameBytes.some((byte) => byte > 0x7f);
    if (hasNonAscii) {
      try {
        decoder.decode(nameBytes);
      } catch {
        throw new Error("ZIP 中存在无法识别为 UTF-8 的非 ASCII 文件名");
      }
      bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 0x0800, offset + 8);
      const localOffset = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(localOffset) !== localSignature) throw new Error("ZIP 本地文件头结构异常");
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

  const listed = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter(include);

  for (const relative of listed) {
    const extension = path.extname(relative).toLowerCase();
    if ([".xlsx", ".xls", ".xlsm", ".docx", ".yaml", ".yml", ".pyc", ".pyo"].includes(extension)) continue;
    if (!supportedExtensions.has(extension)) {
      throw new Error(`SkillHub 包含未允许的文件类型：${relative}`);
    }
    const source = path.join(root, relative);
    const destination = path.join(bundle, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const rootSkill = path.join(bundle, "SKILL.md");
  if (!fs.existsSync(rootSkill)) throw new Error("SkillHub 包根目录缺少 SKILL.md");
  const skillText = fs.readFileSync(rootSkill, "utf8");
  if (!skillText.startsWith("---\n") || !/^name:\s*lawyerbuddy\s*$/m.test(skillText)
      || !/^description:\s*.+$/m.test(skillText)) {
    throw new Error("根 SKILL.md 缺少有效的 YAML name/description");
  }

  const files = collectFiles(bundle);
  if (files.length > maxFiles) throw new Error(`文件数超出 SkillHub 上限：${files.length}/${maxFiles}`);
  const licenseFiles = files.filter((file) => path.basename(file).toUpperCase() === "LICENSE");
  if (licenseFiles.length) throw new Error(`发现不允许上传的 LICENSE 文件：${licenseFiles.join("、")}`);
  const disallowed = files.filter((file) => !supportedExtensions.has(path.extname(file).toLowerCase()));
  if (disallowed.length) throw new Error(`发现不支持的文件：${disallowed.join("、")}`);

  // SkillHub 的付费预检会取文件列表中第一个 basename 为 SKILL.md 的文件。
  // 包内含多个子 Skill 的 SKILL.md，因此必须把唯一根入口排在 ZIP 第一项。
  const archiveFiles = ["SKILL.md", ...files.filter((file) => file !== "SKILL.md").sort()];
  run("zip", ["-q", archive, ...archiveFiles], { cwd: bundle });
  markUtf8Filenames(archive);
  const zipEntries = run("unzip", ["-Z1", archive]).split(/\r?\n/).filter(Boolean);
  if (zipEntries[0] !== "SKILL.md") {
    throw new Error(`ZIP 第一项必须是根 SKILL.md，实际为：${zipEntries[0] || "(空)"}`);
  }
  if (zipEntries.filter((entry) => entry === "SKILL.md").length !== 1) {
    throw new Error("ZIP 必须且仅能包含一个根目录 SKILL.md；嵌套子技能文件名需另行处理");
  }
  if (zipEntries.some((entry) => path.basename(entry).toUpperCase() === "LICENSE")) {
    throw new Error("ZIP 中发现不允许上传的 LICENSE 文件");
  }

  console.log(JSON.stringify({
    folder: bundle,
    zip: archive,
    files: files.length,
    limit: maxFiles,
    unsupported_files: 0,
    root_skill: "SKILL.md",
    cause_catalog: "skills/lawyerbuddy-sorting/assets/民事案件案由参考表_2025.json",
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
