# Sur3aa — Project Instructions for Claude Code

## Role division
- **Claude.ai (monitor):** architecture decisions, explanations, phase planning, reviewing output, catching mistakes.
- **Claude Code (executor):** writes files, runs commands, edits code based on explicit instructions.

## How to receive instructions
Claude Code will receive tasks as structured instructions. Each instruction will specify:
- **What to do** (the task)
- **Where to do it** (file paths)
- **Why** (brief context so decisions stay consistent)
- **What NOT to do** (constraints)

Do not improvise beyond the instruction scope. If something is ambiguous, output a question prefixed with `[CLARIFICATION NEEDED]` instead of guessing.

## Project overview
Sor3a is a personal YouTube downloader with two parts:
1. A **Brave browser extension** that detects YouTube pages and triggers downloads.
2. A **local Node.js server** that receives download requests and runs yt-dlp.

## Repo structure
sur3aa/
├── CLAUDE.md               ← this file
├── server/                 ← Node.js local server
│   ├── index.js
│   ├── package.json
│   └── routes/
└── extension/              ← Brave/Chrome extension
    ├── manifest.json
    ├── content_script.js
    ├── background.js
    └── popup/

## Coding principles
- Keep files small and single-purpose.
- Prefer clarity over cleverness — this codebase should be readable by someone learning.
- Add a one-line comment above any non-obvious block of code.
- Do not install packages that aren't explicitly requested.
- Do not modify files outside the scope of the current instruction.
- Each phase ends with a git commit before moving to the next. Commit message format: "Phase N: short description"

## Tech stack
- Server: Node.js, Express, child_process (for yt-dlp)
- Extension: Vanilla JS, Manifest V3
- No frameworks, no bundlers unless explicitly introduced later.

## Communication protocol (extension ↔ server)
- Extension sends POST requests to http://localhost:3333
- Server responds with JSON
- CORS must be enabled on the server for extension origins

## Current phase
Phase 5 — Format selection (in progress)
