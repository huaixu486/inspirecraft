# InspireCraft

<p align="center">
  <a href="https://github.com/huaixu486/inspirecraft/releases"><img src="https://img.shields.io/github/v/release/huaixu486/inspirecraft?display_name=tag&style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/huaixu486/inspirecraft?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white&style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white&style=flat-square" alt="Electron 33">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white&style=flat-square" alt="React 18">
  <img src="https://img.shields.io/github/downloads/huaixu486/inspirecraft/total?style=flat-square" alt="Downloads">
</p>

InspireCraft is a desktop workspace for managing project materials, stage deliverables, and collaborative workflows. It brings project files, template-based writing, document review, task planning, and team collaboration into one place—from source materials to completed stage deliverables.

## Highlights

- **Projects and stages** — Organize files by project and stage, monitor progress, and keep next actions visible.
- **File workspace** — Import, search, version, and manage properties for project files.
- **AI-assisted writing** — Generate first drafts from prompts, templates, reference materials, and stage context, then refine them collaboratively.
- **Templates and formatting** — Define document structures and Word formatting rules, then apply them during export.
- **Document review** — Check chapters, formatting, and content issues, then turn findings into editable AI and human workflows.
- **Planning and collaboration** — Manage plans, tasks, collaboration activity, messages, and reminders.
- **Flexible AI providers** — Configure multiple model providers and models for different writing and review scenarios.

## Tech Stack

- Electron 33
- React 18 + TypeScript
- Vite
- Ant Design
- Zustand

## Getting Started

Install Node.js 18 or later, then run:

```bash
npm install
npm run dev
```

## Common Commands

```bash
# Type-check and build the main and renderer processes
npm run build

# Run tests
npm run test

# Package a Windows x64 NSIS installer
npm run pack:win
```

The installer is written to `release/ProjectHub-Setup-<version>.exe` by default.

## Workflow Overview

1. Create a project from the overview, or import an existing project folder.
2. Organize source materials in File Details and associate files with stages and templates.
3. Use Team Writing or the Report workspace to create drafts, review documents, and plan follow-up work.
4. Configure AI models, prompt templates, automation rules, and keyboard shortcuts in Settings.

## Data and Privacy

Project files and AI settings may contain sensitive information. Only commit content suitable for public distribution. Keep project materials, sample templates, API keys, and internal documentation local, and exclude them through `.gitignore`.

## Contributing

Issues and pull requests are welcome. Before submitting a change, run the relevant tests and do not commit project materials, account credentials, model keys, or other internal files.

## License

This project is licensed under the [MIT License](LICENSE).
