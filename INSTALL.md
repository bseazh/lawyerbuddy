# 安装指引（供用户与 Agent 阅读）

这份文件是安装前入口。安装尚未完成时，Skill 本体无法自动运行，因此请先让 Agent 阅读本文件，再执行命令。

## 推荐安装流程

### 1. 一次性安装器安全检查

先确认电脑已有 Node.js 18 或更高版本以及 Git。首次安装或切换版本时，检查同一版本标签下的 `package.json` 和 `bin/cli.js`。本文以 `v1.9.5` 为例：

- `package.json` 不应包含 `preinstall`、`install`、`postinstall` 等自动执行脚本；
- `bin/cli.js` 的 `install` 应先把清单中的全部 Skill 和共享运行层复制到 `.agents` 下的临时目录，完整后再迁入正式位置，并把已审查的 CLI 复制为总路由的本地 `scripts/doctor.js`；
- `doctor` 只应检查环境并输出建议，不应自动安装 Python 包、OCR 工具或浏览器。

这一步确认安装器不会在安装阶段执行额外动作，不等于对 Skill 后续全部处理脚本做全面代码审计。同一标签或提交已完成检查后，不要重复发起多轮网络审查。仓库内容或目标版本变化时重新检查。审查链接与安装命令必须使用同一个标签或提交，不能审查 `main` 后再安装另一个版本。

### 2. 安装 Skill

在目标项目目录中运行：

```bash
npx --yes github:bseazh/lawyerbuddy#v1.9.5 install
```

Agent 执行远程 `npx github:` 命令时，应把工具等待时间设为至少 300 秒。若工具单次等待上限不足，应保留同一执行会话并持续轮询，累计至少等待 300 秒，不主动终止进程。这里的 300 秒是 Agent 工具参数，不是在命令前额外添加 `timeout`。

如果进程在接近工具时间上限时以 `137`、`SIGTERM` 或超时结束：

1. 先检查 `.agents/skills/lawyerbuddy/SKILL.md`、`.agents/skills/lawyerbuddy-sorting/requirements.txt`、`.agents/skills/lawyerbuddy-sorting/references/installation.md`、`.agents/skills/lawyerbuddy/scripts/doctor.js`、`.agents/lawyerbuddy/install-manifest.json` 和 `.agents/lawyerbuddy/routing/capability-index.json` 是否全部存在；
2. 不齐全时不把它视为安装成功；原子安装正常不会留下正式半成品目录，可使用同一命令和至少 300 秒等待时间重试一次；若正式目标目录异常存在，则先报告并由用户决定备份或移走，不自动删除；
3. 已存在时不要反复安装，直接进入环境检查；
4. 若明显早于 300 秒且没有持续下载迹象就返回 `137`，检查错误输出并考虑内存不足，不应无限重试。

### 3. 检查环境

```bash
node .agents/skills/lawyerbuddy/scripts/doctor.js doctor
```

这一步完全从本地运行，不再请求 GitHub。首次 `doctor` 返回退出码 `1` 通常表示检查成功但发现核心依赖缺失，不等于 Skill 下载失败；按照输出补齐依赖后再验收。Poppler、Tesseract 和浏览器属于按需能力，不自动安装，也不阻塞其他材料整理。

### 4. 安装核心 Python 依赖

中国大陆网络默认使用清华 PyPI 镜像：

```bash
.lawyerbuddy-env/bin/python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r .agents/skills/lawyerbuddy-sorting/requirements.txt
```

Windows PowerShell：

```powershell
.\.lawyerbuddy-env\Scripts\python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r .agents\skills\lawyerbuddy-sorting\requirements.txt
```

清华镜像不可达时，改用中科大镜像：

- 清华：`https://pypi.tuna.tsinghua.edu.cn/simple`
- 中科大：`https://pypi.mirrors.ustc.edu.cn/simple`
- 每个国内镜像最多尝试一次；返回 `502`、`403`、TLS 或代理错误时停止重试并排查代理；
- 不关闭 TLS 校验，不使用 `--trusted-host` 绕过证书检查。

不要用 `tail` 等方式截断安装结果。以命令退出码为准，并保留 `Successfully installed`、`Requirement already satisfied` 或完整错误摘要。

### 5. 按任务安装 OCR/PDF 组件

首次安装不要安装 Poppler、Tesseract 或浏览器。只有实际任务包含相应材料时才补装：

- 需要提取普通文本型 PDF：只安装 Poppler；
- 需要识别图片、聊天截图或扫描 PDF：安装 Poppler、Tesseract 和中文语言包；
- 只处理 DOCX、XLSX、TXT、CSV、JSON 或已有文字稿：不安装这些组件。

macOS 使用中科大 Homebrew 镜像，镜像变量只对本次命令生效：

```bash
# 普通文本型 PDF
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles brew install poppler

# 图片、聊天截图或扫描 PDF OCR
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles brew install poppler tesseract tesseract-lang
```

清华 Homebrew 镜像可作为备用，将两个域名统一替换为：

```text
https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api
https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles
```

镜像提供的是 Homebrew 官方 bottle 的国内同步副本，Homebrew 仍会校验 SHA256。不要直接访问 `ghcr.io` 反复重试，也不要关闭校验。

### 6. 一次验收

依赖安装结束后只需再运行一次 `doctor`。核心项全部显示 `OK` 即完成；可选项缺失只说明对应能力暂不可用。

## 给 Agent 的完成标准

- 安装命令退出成功，安装清单中的全部 Skill、共享运行层和安装清单全部存在；
- Python 依赖命令退出成功，不仅凭最后几行输出判断；
- 最终 `doctor` 的核心项全部为 `OK`；
- 向用户报告缺失的可选能力，但不擅自下载大体积组件；
- 不因网络慢重复执行安全审查或创建多个安装副本。
