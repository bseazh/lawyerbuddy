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
npx --yes github:bseazh/lawyerbuddy#v1.9.1 install
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

## 导入 WorkBuddy 或 SkillHub

在仓库根目录运行：

```bash
npm run pack:workbuddy
npm run pack:skillhub
npm run pack:skillhub:paid
```

前两个命令生成免费本地公共包；`pack:skillhub:paid` 生成支付宝永久激活版 Pay Skill。发布普通 Skill 时上传 `lawyerbuddy-skillhub-public-v版本.zip`；选择“发布付费 Skill”时必须上传 `lawyerbuddy-skillhub-paid-v版本.zip`。不要混用两个包。

SkillHub 包只包含本地法律工作所需的总路由、产品 Skill、共享规则和内置能力，不包含测试文件、本地缓存、Python 字节码、密钥或服务器配置。打包器会检查根 `SKILL.md` 的 YAML `name` 与 `description`，并确保 ZIP 第一项是根入口。

付费包首次使用时交付永久授权，单价 `0.01 元`；激活后不重复收费。支付实现、隐私边界和发布检查以 `packaging/skillhub-paid/` 中的专用入口为准。

## 版本更新

更新后重新运行打包命令，并上传新的版本文件夹或 ZIP。建议先在一份测试案件文件夹上验证目录树预览、归档结果、案件报告和时间轴，再交给律师使用。

更多可复制提示词见 [`docs/使用指南.md`](./docs/使用指南.md)，安装环境说明见 [`INSTALL.md`](./INSTALL.md)。
