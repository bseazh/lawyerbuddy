# LawyerBuddy

LawyerBuddy 是面向律师的本地法律工作助手。它提供一个总路由和八个可按需调用的产品 Skill：材料整理、案件总结、关键时间轴、类案检索、起诉状起草、其他法律文书起草、合同起草和合同审查。

本项目按本地文件工作。案件材料只在当前工作区读取，原始材料默认保持不变；不会自动上传案件材料、下载外部代码或执行未知程序。所有报告和建议都需要律师复核，不替律师作法律结论。

## 目录

```text
SKILL.md                         总路由
skills/                          产品 Skill 与参考规则
runtime/routing/                 路由、流程和共享契约
runtime/capabilities/            内置中文法律能力
docs/使用指南.md                  面向律师的操作示例
```

## 最快开始

### 1. 安装

需要 Node.js 18 或更高版本。把下面的提示词直接交给 Codex、Claude Code、WorkBuddy 等能够访问本地文件的 Agent：

```text
请安装并检查 LawyerBuddy：
npx --yes github:bseazh/lawyerbuddy#v1.9.2 install
node .agents/skills/lawyerbuddy/scripts/doctor.js doctor
```

远程安装第一次可能需要几分钟；请给 Agent 至少 5 分钟的命令等待时间。安装器不会自动安装大体积 OCR、PDF 或浏览器组件，只有任务需要时再按 `INSTALL.md` 补装。

### 2. 提供案件文件夹

- macOS：在 Finder 选中文件夹，按 `Option + Command + C` 复制绝对路径。
- Windows：按住 `Shift` 右键文件夹，选择“复制为路径”；也可以按 `Alt + D` 复制地址栏。
- 也可以在 Agent 中使用 “Open Folder” 或 “Add Folder to Workspace”。

### 3. 开始整理

```text
@lawyerbuddy

请整理这个案件材料文件夹：
/填写案件材料文件夹的绝对路径

先检查材料和录音逐字稿，再提出案由候选。请展示案件名称、目录树、文件改名预览和待确认事项；等我确认后再复制归档。完成后请给出整理结果、报告和时间轴的绝对路径。
```

发现录音但没有逐字稿时，先保留录音原件并列出缺失清单；补齐逐字稿后再继续案件分析。案件整理默认先给出快速初稿和可视化时间轴，之后可按金额、付款、主体、合同关系或指定材料继续核对。

Agent 会先让律师确认目录方案：

```text
A. 使用默认目录

001 主体信息/
002 基础资料/
003 委托材料/
004 类案及法律检索/
005 法律文书/

B. 自定义一级、二级目录
```

选择默认目录后，`002 基础资料` 仍会根据本案合同、付款、履行、沟通、鉴定等实际内容自动提出二级目录；Agent 展示完整目录树和改名结果并再次确认后，才执行复制归档。

## 产品 Skill

| 场景 | 调用方式 |
| --- | --- |
| 材料分类、改名、归档 | `@lawyerbuddy-sorting` |
| 案件梳理 Word 报告 | `@lawyerbuddy-summarizing` |
| 可视化关键时间轴 | `@lawyerbuddy-timeline` |
| 类案及裁判规则检索 | `@lawyerbuddy-similar-case-retrieval` |
| 民事起诉状 | `@lawyerbuddy-complaint-draft` |
| 答辩状、代理词、律师函等 | `@lawyerbuddy-document-drafting` |
| 合同或协议起草 | `@lawyerbuddy-contract-draft` |
| 合同审查 | `@lawyerbuddy-contract-review` |

复杂任务建议按以下顺序执行：

```text
材料整理 → 案件报告 → 可视化时间轴 → 类案检索或文书起草
```

## 快速使用模板

以下提示词可以直接复制到 Agent 中使用。路径必须替换为实际的绝对路径；在 macOS Finder 中选中文件夹后按 `Option + Command + C` 可复制路径。

### 整理案件资料

```text
@lawyerbuddy-sorting

请整理以下案件材料文件夹：
/填写原始材料文件夹绝对路径

先清点全部文件，识别案由候选、当事人和录音逐字稿；先展示案件名称、目录树和文件改名预览，等我确认后再复制归档。原始材料保持不变，完成后给出整理结果的绝对路径。
```

### 生成案件报告

```text
@lawyerbuddy-summarizing

请根据以下已确认并完成归档的案件目录生成案件梳理报告：
/填写整理结果文件夹绝对路径

报告包含案件主体、案件总结、关键事实、法律要素和文件清单。只写材料能够支持的客观事实，冲突或缺失内容标为“待确认”，输出 Word 报告绝对路径。
```

### 生成可视化时间轴

```text
@lawyerbuddy-timeline

请根据以下案件报告生成专业、清晰的可视化关键时间轴：
/填写案件报告或整理结果文件夹绝对路径

只展示与争议主线直接相关的事件；日期不明的内容放入“日期待确认”。输出 HTML，并在环境支持时同时输出 PNG/PDF，最后列出所有绝对路径。
```

### 类案和裁判规则检索

```text
@lawyerbuddy-similar-case-retrieval

请围绕以下案件进行类案检索：
/填写案件报告或案件目录绝对路径

检索重点：争议案由、关键事实、争议焦点、法院裁判规则和相似案件差异。请区分已检索到的资料与分析意见，列出检索范围、来源和仍需核实的问题，不要把类案结论直接当成本案结论。
```

### 起草法律文书

```text
@lawyerbuddy-complaint-draft

请根据以下案件目录起草【民事起诉状 / 答辩状 / 上诉状 / 代理词 / 律师函】：
/填写案件目录绝对路径

我方身份：【原告 / 被告 / 其他】
程序阶段：【一审 / 二审 / 执行 / 非诉】
请先给出文书提纲、材料支持的事实和待确认事项；确认后再生成 Word 初稿。不要补造身份、金额、日期、请求或法律依据。
```

### 起草或审查合同

起草新合同或协议：

```text
@lawyerbuddy-contract-draft

请根据以下交易条件起草【合同/协议类型】：
/填写交易材料或条件文件夹绝对路径

我方身份及立场：【填写】
请先列出主要待确认事项和条款提纲，确认后生成可编辑 Word 初稿。
```

审查已有合同：

```text
@lawyerbuddy-contract-review

请审查以下合同并按“条款位置—风险—影响—修改建议”输出：
/填写合同文件绝对路径

重点关注：【付款 / 交付 / 违约责任 / 保密 / 解除 / 争议解决等】
不要把风险提示写成已经发生的事实。
```

案件整理完成后，建议继续执行“案件报告 → 可视化时间轴”；文书起草或类案检索应尽量使用已确认的案件目录和报告。

## 导入 WorkBuddy 或 SkillHub

在仓库根目录运行：

```bash
npm run pack:workbuddy
npm run pack:skillhub
npm run pack:skillhub:paid
```

SkillHub 包只包含本地法律工作所需的总路由、产品 Skill、共享规则和内置能力，不包含测试文件、本地缓存、Python 字节码、密钥或服务器配置。打包器会检查根 `SKILL.md` 的 YAML `name` 与 `description`，并确保 ZIP 第一项是根入口。付费入口的安装与运行说明位于 `skills/lawyerbuddy-paid/`，不会进入免费本地包。

## 版本更新

更新后重新运行打包命令，并上传新的版本文件夹或 ZIP。建议先在一份测试案件文件夹上验证目录树预览、归档结果、案件报告和时间轴，再交给律师使用。

更多可复制提示词见 [`docs/使用指南.md`](./docs/使用指南.md)，安装环境说明见 [`INSTALL.md`](./INSTALL.md)。
