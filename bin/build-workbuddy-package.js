#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outputDirectory = path.join(root, "dist");
const folder = path.join(outputDirectory, `lawyerbuddy-workbuddy-v${pkg.version}`);
const archive = `${folder}.zip`;
const packagePaths = ["SKILL.md", "README.md", "INSTALL.md", "bin/cli.js", "package.json", "skills", "runtime", "manifests", "docs"];

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
  let offset = bytes.readUInt32LE(eocd + 16);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralSignature) throw new Error("ZIP 中央目录结构异常");
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    if (nameBytes.some((byte) => byte > 0x7f)) {
      decoder.decode(nameBytes);
      bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 0x0800, offset + 8);
      const localOffset = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(localOffset) !== localSignature) throw new Error("ZIP 本地文件头结构异常");
      bytes.writeUInt16LE(bytes.readUInt16LE(localOffset + 6) | 0x0800, localOffset + 6);
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  fs.writeFileSync(archivePath, bytes);
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(folder, { recursive: true, force: true });
fs.rmSync(archive, { force: true });

const listResult = spawnSync("git", ["ls-files", "--cached", "-z", "--", ...packagePaths], {
  cwd: root,
  encoding: "buffer",
});
if (listResult.status !== 0) {
  console.error(listResult.stderr?.toString("utf8") || "无法读取 Workbuddy 上传文件清单");
  process.exit(listResult.status || 1);
}

fs.mkdirSync(folder, { recursive: true });
const listedFiles = listResult.stdout.toString("utf8").split("\0").filter(Boolean);
for (const relative of listedFiles) {
  const source = path.join(root, relative);
  const destination = path.join(folder, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

// 服务端部署代码不得进入客户端上传包；授权客户端必须随产品 Skill 一起安装。
for (const relative of ["services"]) {
  fs.rmSync(path.join(folder, relative), { recursive: true, force: true });
}

function collectFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, relative);
    return entry.isFile() ? [relative] : [];
  });
}

const folderEntries = collectFiles(folder);
const archiveEntries = ["SKILL.md", ...folderEntries.filter((entry) => entry !== "SKILL.md").sort()];
const zipResult = spawnSync("zip", ["-q", archive, ...archiveEntries], {
  cwd: folder,
  encoding: "utf8",
});
if (zipResult.status !== 0) {
  console.error(zipResult.stderr || zipResult.stdout || "无法生成 Workbuddy ZIP");
  process.exit(zipResult.status || 1);
}
markUtf8Filenames(archive);

const skillPath = path.join(folder, "SKILL.md");
if (!fs.existsSync(skillPath)) {
  console.error("打包失败：上传文件夹根目录缺少 SKILL.md");
  process.exit(1);
}
const skillText = fs.readFileSync(skillPath, "utf8");
if (!skillText.startsWith("---\n") || !/^name:\s*lawyerbuddy\s*$/m.test(skillText)
    || !/^description:\s*.+$/m.test(skillText)) {
  console.error("打包失败：根 SKILL.md 缺少有效的 YAML name/description");
  process.exit(1);
}

const verify = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
if (verify.status !== 0) {
  console.error(verify.stderr || "无法检查 Workbuddy ZIP");
  process.exit(verify.status || 1);
}
const entries = verify.stdout.split(/\r?\n/).filter(Boolean);
if (!entries.includes("SKILL.md")) {
  console.error("打包失败：ZIP 顶层缺少 SKILL.md");
  process.exit(1);
}
if (entries.some((entry) => path.basename(entry).toUpperCase() === "LICENSE")) {
  console.error("打包失败：ZIP 中发现不允许上传的 LICENSE 文件");
  process.exit(1);
}
console.log(JSON.stringify({
  folder,
  zip: archive,
  version: pkg.version,
  source_ref: "working-tree",
  root_skill: "SKILL.md",
  excluded: ["examples/", "tests/", "services/"],
  entries: entries.length,
  size: fs.statSync(archive).size,
}, null, 2));
