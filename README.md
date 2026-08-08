# 灵作（InspireCraft）

<p align="center">
  <a href="https://github.com/huaixu486/inspirecraft/releases"><img src="https://img.shields.io/github/v/release/huaixu486/inspirecraft?display_name=tag&style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/huaixu486/inspirecraft?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white&style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white&style=flat-square" alt="Electron 33">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white&style=flat-square" alt="React 18">
  <img src="https://img.shields.io/github/downloads/huaixu486/inspirecraft/total?style=flat-square" alt="Downloads">
</p>

灵作（InspireCraft）是一款面向项目资料、阶段文档与协作流程的桌面项目管理工具。它将项目文件、模板写作、审查修订、任务规划与团队协作放在同一个工作台中，帮助团队持续推进从项目资料到阶段交付物的完整流程。

## 功能概览

- 项目与阶段管理：按项目、阶段组织文件，查看阶段进度与下一步事项。
- 文件工作台：导入、检索、版本管理和文件属性管理。
- AI 写作：基于提示词、模板、参考资料和阶段信息生成初稿，并支持后续修订。
- 模板与格式：配置写作模板、章节结构和 Word 格式规则，导出时应用对应格式。
- 文档审查：检查章节、格式和内容问题，生成可编辑的 AI 与人工工作流。
- 计划与协作：管理计划、任务、协作动态、消息和待办事项。
- AI 接入：支持配置多个模型供应商和模型，用于不同写作与审查场景。

## 技术栈

- Electron 33
- React 18 + TypeScript
- Vite
- Ant Design
- Zustand

## 开发运行

请先安装 Node.js 18 或更高版本，然后执行：

```bash
npm install
npm run dev
```

## 常用命令

```bash
# 类型检查、主进程与渲染进程构建
npm run build

# 运行测试
npm run test

# 打包 Windows x64 NSIS 安装程序
npm run pack:win
```

安装包默认输出到 `release/ProjectHub-Setup-<version>.exe`。

## 使用说明

1. 在项目总览中新建项目，或导入已有项目文件夹。
2. 在文件详情中整理项目资料，并为文件关联阶段和模板。
3. 通过团队写作或报告工作台生成初稿、审查文档并安排后续任务。
4. 在设置页配置 AI 模型、提示词模板、自动化规则和快捷键。

## 数据与隐私

项目文件和 AI 配置可能包含敏感信息。请仅将适合公开的内容提交到代码仓库；个人项目资料、模板范文、密钥与内部文档应保留在本地，并通过 `.gitignore` 排除。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请运行与修改相关的测试，并避免提交项目资料、账号凭据、模型密钥或其他内部文件。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
