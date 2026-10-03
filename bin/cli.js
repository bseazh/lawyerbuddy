#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const command = process.argv[2] || "install";

function repositoryRoot() {
  return path.resolve(__dirname, "..");
}

function manifestPath() {
  return isInstalledDoctor()
    ? path.resolve(__dirname, "..", "..", "..", "lawyerbuddy", "skills.json")
    : path.join(repositoryRoot(), "manifests", "skills.json");
}

function loadSkillManifest() {
  const location = manifestPath();
  if (!fs.existsSync(location)) {
    console.error(`缺少 LawyerBuddy Skill 清单：${location}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(location, "utf8"));
}

function loadJson(location, label) {
  if (!fs.existsSync(location)) {
    console.error(`缺少 ${label}：${location}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(location, "utf8"));
  } catch (error) {
    console.error(`${label} 无法读取：${error.message}`);
    process.exit(1);
  }
}

function targetProject() {
  const index = process.argv.indexOf("--target");
  if (index === -1) return process.cwd();
  if (!process.argv[index + 1]) {
    console.error("--target 后需要提供项目目录路径。");
    process.exit(1);
  }
  return path.resolve(process.argv[index + 1]);
}

function install() {
  const sourceRoot = repositoryRoot();
  const skillsSource = path.join(sourceRoot, "skills");
  const runtimeSource = path.join(sourceRoot, "runtime");
  const manifestSource = path.join(sourceRoot, "manifests", "skills.json");
  const manifest = loadSkillManifest();
  const skillNames = manifest.skills.map((skill) => skill.name);
  const project = targetProject();
  const agentsRoot = path.join(project, ".agents");
  const skillsTargetRoot = path.join(agentsRoot, "skills");
  const runtimeTarget = path.join(agentsRoot, "lawyerbuddy");
  const targets = skillNames.map((name) => path.join(skillsTargetRoot, name));
  const missingSources = skillNames.filter((name) => !fs.existsSync(path.join(skillsSource, name, "SKILL.md")));
  if (missingSources.length || !fs.existsSync(runtimeSource) || !fs.existsSync(manifestSource)) {
    console.error(`安装包内容不完整：${missingSources.join("、") || "共享运行层或 Skill 清单缺失"}`);
    process.exit(1);
  }
  const conflicts = [...targets, runtimeTarget].filter((target) => fs.existsSync(target));
  if (conflicts.length) {
    console.error("以下目标已存在，本次未覆盖：");
    conflicts.forEach((target) => console.error(target));
    console.error("请先备份或移走旧版本，再重新执行安装。");
    process.exit(1);
  }
  const staging = path.join(agentsRoot, `.lawyerbuddy.installing-${process.pid}`);
  const stagedSkills = path.join(staging, "skills");
  const stagedRuntime = path.join(staging, "runtime");
  const installedTargets = [];
  fs.mkdirSync(skillsTargetRoot, { recursive: true });
  try {
    fs.mkdirSync(stagedSkills, { recursive: true });
    skillNames.forEach((name) => {
      fs.cpSync(path.join(skillsSource, name), path.join(stagedSkills, name), {
        recursive: true, errorOnExist: true
      });
    });
    fs.cpSync(runtimeSource, stagedRuntime, { recursive: true, errorOnExist: true });
    fs.rmSync(path.join(stagedRuntime, "payment"), { recursive: true, force: true });
    fs.copyFileSync(manifestSource, path.join(stagedRuntime, "skills.json"));
    const routerScripts = path.join(stagedSkills, "lawyerbuddy", "scripts");
    fs.mkdirSync(routerScripts, { recursive: true });
    fs.copyFileSync(__filename, path.join(routerScripts, "doctor.js"));
    fs.writeFileSync(path.join(stagedRuntime, "install-manifest.json"), JSON.stringify({
      suite: "lawyerbuddy",
      version: require(path.join(sourceRoot, "package.json")).version,
      installed_at: new Date().toISOString(),
      skills: manifest.skills
    }, null, 2) + "\n");
    skillNames.forEach((name) => {
      const target = path.join(skillsTargetRoot, name);
      fs.renameSync(path.join(stagedSkills, name), target);
      installedTargets.push(target);
    });
    fs.renameSync(stagedRuntime, runtimeTarget);
    installedTargets.push(runtimeTarget);
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    installedTargets.reverse().forEach((target) => fs.rmSync(target, { recursive: true, force: true }));
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    console.error(`Skill 安装未完成：${error.message}`);
    process.exit(1);
  }
  console.log(`LawyerBuddy 安装完成：${skillNames.length} 个 Skill`);
  targets.forEach((target) => console.log(target));
  console.log(`共享运行层：${runtimeTarget}`);
  console.log("\n下一步在项目目录运行本地环境检查（不再访问 GitHub）：");
  console.log(`node "${path.join(skillsTargetRoot, "lawyerbuddy", "scripts", "doctor.js")}" doctor --target "${project}"`);
}

function isInstalledDoctor() {
  return path.basename(__filename) === "doctor.js"
    && fs.existsSync(path.resolve(__dirname, "..", "SKILL.md"));
}

function sortingSkillRoot(project) {
  return isInstalledDoctor()
    ? path.join(project, ".agents", "skills", "lawyerbuddy-sorting")
    : path.resolve(__dirname, "..", "skills", "lawyerbuddy-sorting");
}

function suitePaths(project) {
  if (isInstalledDoctor()) {
    return {
      skills: path.join(project, ".agents", "skills"),
      runtime: path.join(project, ".agents", "lawyerbuddy")
    };
  }
  return {
    skills: path.join(repositoryRoot(), "skills"),
    runtime: path.join(repositoryRoot(), "runtime")
  };
}

function check(label, executable, args = ["--version"], optional = false) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  const ok = !result.error && result.status === 0;
  printStatus(label, ok, optional);
  return ok;
}

function printStatus(label, ok, optional = false) {
  const mark = ok ? "OK" : optional ? "可选-未发现" : "缺少";
  console.log(`${mark.padEnd(9)} ${label}`);
}

function findPython(project) {
  const projectCandidates = [
    path.join(project, ".lawyerbuddy-env", "bin", "python"),
    path.join(project, ".lawyerbuddy-env", "Scripts", "python.exe")
  ].filter((executable) => fs.existsSync(executable)).map((executable) => ({
    executable, prefix: [], source: "项目环境"
  }));
  const candidates = [...projectCandidates,
    { executable: "python3", prefix: [] },
    { executable: "python", prefix: [] },
    { executable: "py", prefix: ["-3"] }
  ];
  let unsupported = null;
  for (const candidate of candidates) {
    const result = spawnSync(candidate.executable, [...candidate.prefix, "--version"], { encoding: "utf8" });
    const output = `${result.stdout || ""} ${result.stderr || ""}`;
    const match = output.match(/Python\s+(\d+)\.(\d+)/);
    if (!result.error && result.status === 0 && match) {
      const supported = Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 9);
      const found = { ...candidate, supported, version: `${match[1]}.${match[2]}` };
      if (supported) return found;
      unsupported ||= found;
    }
  }
  return unsupported;
}

function pythonArgs(python, args) {
  return [...python.prefix, ...args];
}

function pythonCommand(python) {
  return [python.executable, ...python.prefix].join(" ");
}

function checkPythonPackage(label, moduleName, distribution, minimum, python, optional = false) {
  const minimumTuple = minimum.split(".").map(Number).join(",");
  const code = [
    "import importlib, importlib.metadata as metadata, re",
    `importlib.import_module(${JSON.stringify(moduleName)})`,
    `version = metadata.version(${JSON.stringify(distribution)})`,
    "parts = tuple(int(x) for x in re.findall(r'\\d+', version)[:2])",
    `assert parts >= (${minimumTuple},), version`
  ].join("; ");
  return check(`${label} >= ${minimum}`, python.executable, pythonArgs(python, ["-c", code]), optional);
}

function checkChineseOcr() {
  const result = spawnSync("tesseract", ["--list-langs"], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const ok = !result.error && result.status === 0 && /(^|\s)chi_sim(\s|$)/m.test(output);
  console.log(`${(ok ? "OK" : "可选-未发现").padEnd(9)} Tesseract 简体中文语言包`);
  return ok;
}

function checkBrowser() {
  const commands = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "microsoft-edge", "microsoft-edge-stable"
  ];
  const commandFound = commands.some((name) => {
    const result = spawnSync(name, ["--version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  });
  const locations = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  const locationWorks = locations.some((location) => {
    if (!fs.existsSync(location)) return false;
    const result = spawnSync(location, ["--version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  });
  const ok = commandFound || locationWorks;
  printStatus("Chrome/Edge/Chromium（PNG/PDF时间轴）", ok, true);
  return ok;
}

function doctor() {
  console.log("LawyerBuddy 环境检查\n");
  const project = targetProject();
  const manifest = loadSkillManifest();
  const locations = suitePaths(project);
  const suiteOk = manifest.skills.every((skill) => fs.existsSync(path.join(locations.skills, skill.name, "SKILL.md")))
    && fs.existsSync(path.join(locations.runtime, "contracts", "case-data.schema.json"));
  printStatus(`LawyerBuddy 套件（${manifest.skills.length} 个 Skill）`, suiteOk);
  const capabilityIndexPath = path.join(locations.runtime, "routing", "capability-index.json");
  const pipelinePath = path.join(locations.runtime, "routing", "pipelines.json");
  const aliasPath = path.join(locations.runtime, "routing", "aliases.json");
  const capabilityIndex = loadJson(capabilityIndexPath, "法律能力索引");
  const capabilityBase = path.join(locations.runtime, "capabilities", "legal-skills-chinese", "skills");
  const capabilitiesOk = capabilityIndex.capabilities.length === 38
    && capabilityIndex.capabilities.every((capability) => fs.existsSync(path.join(capabilityBase, capability.id, "SKILL.md")))
    && fs.existsSync(pipelinePath)
    && fs.existsSync(aliasPath);
  printStatus(`内部法律能力库（${capabilityIndex.capabilities.length} 个能力）`, capabilitiesOk);
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 18;
  printStatus("Node.js >= 18", nodeOk);
  const python = findPython(project);
  const pythonOk = Boolean(python && python.supported);
  const pythonSource = python && python.source ? `，${python.source}` : "";
  printStatus(python ? `Python >= 3.9（当前 ${python.version}${pythonSource}）` : "Python >= 3.9", pythonOk);
  const openpyxlOk = pythonOk && checkPythonPackage(
    "openpyxl（表格材料）", "openpyxl", "openpyxl", "3.1", python
  );
  const catalogDirectory = path.join(sortingSkillRoot(project), "assets");
  const causeCatalogOk = fs.existsSync(path.join(catalogDirectory, "民事案件案由参考表_2025.json"))
    || fs.existsSync(path.join(catalogDirectory, "民事案件案由参考表_2025.xlsx"));
  printStatus("内置民事案件案由参考表", causeCatalogOk);

  const docxOk = pythonOk && checkPythonPackage(
    "python-docx（Word报告）", "docx", "python-docx", "1.1", python
  );

  console.log("\n按需能力");
  const pillowOk = pythonOk && checkPythonPackage(
    "Pillow（图片）", "PIL", "Pillow", "10", python, true
  );
  const pdftotextOk = check("Poppler pdftotext（PDF文字）", "pdftotext", ["-v"], true);
  const pdftoppmOk = check("Poppler pdftoppm（扫描PDF）", "pdftoppm", ["-v"], true);
  const tesseractOk = check("Tesseract（图片OCR）", "tesseract", ["--version"], true);
  const chineseOcrOk = tesseractOk && checkChineseOcr();
  const browserOk = checkBrowser();
  check("LibreOffice（Office预览）", "soffice", ["--version"], true);

  const installedRequirements = path.join(
    project, ".agents", "skills", "lawyerbuddy-sorting", "requirements.txt"
  );
  const bundledRequirements = [
    path.resolve(__dirname, "..", "skills", "lawyerbuddy-sorting", "requirements.txt"),
    path.resolve(__dirname, "..", "requirements.txt")
  ].find((candidate) => fs.existsSync(candidate));
  const requirements = fs.existsSync(installedRequirements) ? installedRequirements : bundledRequirements;
  if (!pythonOk) {
    console.log("\n请先安装 Python 3.9 或更高版本，再重新运行 doctor：");
    console.log("macOS（中科大镜像）: HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles brew install python");
    console.log("Ubuntu/Debian: sudo apt install python3 python3-venv");
    console.log("Windows: winget install Python.Python.3.12");
  }
  if (pythonOk && (!openpyxlOk || !docxOk || !pillowOk)) {
    const launcher = pythonCommand(python);
    const pipOk = check("pip（安装Python依赖）", python.executable, pythonArgs(python, ["-m", "pip", "--version"]));
    const environmentDirectory = path.join(project, ".lawyerbuddy-env");
    const environmentPython = process.platform === "win32"
      ? path.join(environmentDirectory, "Scripts", "python.exe")
      : path.join(environmentDirectory, "bin", "python");
    console.log("\n缺少 Python 依赖。建议使用当前项目的独立环境，不影响系统 Python：");
    if (python.source !== "项目环境") console.log(`${launcher} -m venv "${environmentDirectory}"`);
    console.log("中国大陆网络使用清华 PyPI 镜像：");
    console.log(`"${environmentPython}" -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r "${requirements}"`);
    console.log("清华镜像不可用时，将地址换成中科大：https://pypi.mirrors.ustc.edu.cn/simple");
    console.log("每个镜像最多尝试一次；不要关闭 TLS 校验，也不要添加 --trusted-host。");
    if (!pipOk) console.log(`如无法创建环境，先运行：${launcher} -m ensurepip --upgrade`);
    if (process.platform !== "win32") {
      console.log("Ubuntu/Debian 如提示无法创建环境：sudo apt install python3-venv");
    }
  }
  if (!pdftotextOk || !pdftoppmOk || !tesseractOk || !chineseOcrOk) {
    console.log("\nOCR/PDF 是按需能力：当前任务不含 PDF 深度解析、图片或扫描件 OCR 时，请跳过安装。");
    console.log("缺少组件时，相关文件会标记为“需人工查看”，其他材料仍继续整理。");
    console.log("macOS 普通文本型 PDF（中科大镜像，仅按需执行）：");
    console.log("HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles brew install poppler");
    console.log("macOS 图片/扫描 PDF OCR（中科大镜像，仅按需执行）：");
    console.log("HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles brew install poppler tesseract tesseract-lang");
    console.log("清华备用：将 mirrors.ustc.edu.cn 替换为 mirrors.tuna.tsinghua.edu.cn；Homebrew 仍校验 SHA256。");
    console.log("Ubuntu/Debian: sudo apt install poppler-utils tesseract-ocr tesseract-ocr-chi-sim");
    console.log("Windows: 可先跳过；需要 OCR 时安装 Poppler 与 Tesseract 中文语言包并加入 PATH。");
  }
  if (!browserOk) {
    console.log("\n仅在需要导出时间轴 PNG/PDF 时安装 Chrome、Edge 或 Chromium；HTML 时间轴不受影响。");
  }
  if (!suiteOk || !capabilitiesOk || !nodeOk || !pythonOk || !openpyxlOk || !causeCatalogOk || !docxOk) process.exit(1);
  console.log("\n核心整理能力可用。可选组件缺失只影响对应文件或导出格式。");
}

function listSkills() {
  const manifest = loadSkillManifest();
  console.log("LawyerBuddy Skills\n");
  manifest.skills.forEach((skill) => {
    const status = skill.status === "ready" ? "可用" : "待接入";
    console.log(`${status.padEnd(6)} ${skill.name}`);
  });
}

function listCapabilities() {
  const project = targetProject();
  const locations = suitePaths(project);
  const index = loadJson(path.join(locations.runtime, "routing", "capability-index.json"), "法律能力索引");
  const groups = new Map();
  index.capabilities.forEach((capability) => {
    if (!groups.has(capability.category)) groups.set(capability.category, []);
    groups.get(capability.category).push(capability);
  });
  console.log(`LawyerBuddy 内部法律能力：${index.capabilities.length} 个\n`);
  groups.forEach((capabilities, category) => {
    console.log(`[${category}]`);
    capabilities.forEach((capability) => console.log(`  ${capability.id} - ${capability.name}`));
  });
}

function help() {
  if (isInstalledDoctor()) {
    console.log(`用法：
  node scripts/doctor.js doctor [--target <项目目录>]
  node scripts/doctor.js list
  node scripts/doctor.js capabilities [--target <项目目录>]`);
    return;
  }
  console.log(`用法：
  lawyerbuddy install [--target <项目目录>]
  lawyerbuddy doctor
  lawyerbuddy list
  lawyerbuddy capabilities
  lawyerbuddy help`);
}

if (command === "install" && isInstalledDoctor()) {
  console.error("本地 doctor.js 只用于环境检查，不能执行安装。请使用已审查的远程安装命令。");
  process.exit(1);
} else if (command === "install") install();
else if (command === "doctor") doctor();
else if (command === "list") listSkills();
else if (command === "capabilities") listCapabilities();
else if (command === "help" || command === "--help" || command === "-h") help();
else {
  console.error(`未知命令：${command}`);
  help();
  process.exit(1);
}
