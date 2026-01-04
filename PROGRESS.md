# Development Progress

> Last updated: 2026-01-04 - Phase 1 Complete!
> Resume context: ROADMAP.md Phase 1 implemented

## Current Status: Phase 1 Complete

### Completed
- [x] Created ROADMAP.md with tailored enhancement plan
- [x] Forked repo to ThomasRedstone/claude-code-web
- [x] Set up remotes (origin = fork, upstream = vultuk)
- [x] Updated security dependencies (0 vulnerabilities)
- [x] Added claude-code-web to mani.yaml
- [x] **Mani Integration** (Phase 1.1) - commit 5a8b5e3
  - ManiIntegration utility parsing ~/mani.yaml
  - API: /api/mani/status, /api/mani/projects, /api/mani/tags
  - Tabbed folder browser with search and tag filtering
  - One-click session creation from any of 62+ mani projects
- [x] **Session Templates** (Phase 1.2) - commit aa2e6e4
  - TemplateStore for managing custom templates
  - Built-in templates: Node.js, Python, K8s, Terraform, Quick Task
  - API: /api/templates (CRUD + usage tracking)
  - Templates tab in folder browser UI
  - Save current folder as template
  - Usage frequency tracking

### Next Steps (Phase 2)
1. Workspaces - organize sessions by project type
2. Enhanced split view - vertical splits, grid layouts
3. Session export - Markdown, JSON, HTML formats

---

## Git Status
- Branch: main
- Remote origin: https://github.com/ThomasRedstone/claude-code-web.git
- Remote upstream: https://github.com/vultuk/claude-code-web.git

## Recent Commits
```
aa2e6e4 feat: add session templates for quick-launch presets
5a8b5e3 feat: add mani project integration for quick session creation
47f9ae4 chore(deps): update security dependencies
379fc33 docs: add ROADMAP.md and PROGRESS.md for enhancement tracking
```

## Ports
- **32352**: Production (your active session)
- **32353**: Development (testing)

---

## Features Implemented

### Mani Integration
- **Endpoint**: `/api/mani/projects` - List all 62+ projects from mani.yaml
- **Endpoint**: `/api/mani/tags` - Get project tags (own, fork)
- **Endpoint**: `/api/mani/status` - Check if mani is available
- **UI**: "Mani Projects" tab in folder browser
- **Search**: Filter projects by name or description
- **Tags**: Filter by project tags

### Session Templates
- **Endpoint**: `/api/templates` - CRUD for templates
- **Endpoint**: `/api/templates/frequent` - Most-used templates
- **Endpoint**: `/api/templates/:id/use` - Record template usage
- **UI**: "Templates" tab in folder browser
- **Built-in**: 5 default templates for common workflows
- **Custom**: Save any folder as a reusable template

---

## Files Changed

### Mani Integration
```
src/utils/mani.js          (new)     - Mani config parser
src/server.js              (modified) - API endpoints
src/public/app.js          (modified) - UI handlers
src/public/index.html      (modified) - Mani pane HTML
src/public/style.css       (modified) - Mani styles
```

### Session Templates
```
src/utils/template-store.js (new)    - Template storage
src/server.js               (modified) - Template API endpoints
src/public/app.js           (modified) - Template UI handlers
src/public/index.html       (modified) - Templates pane HTML
src/public/style.css        (modified) - Template styles
```

---

## How to Resume

```bash
# Check current state
git log --oneline -5
cat PROGRESS.md

# Start dev server
node bin/cc-web.js --dev --port 32353 --disable-auth --no-open

# Test endpoints
curl http://localhost:32353/api/mani/projects
curl http://localhost:32353/api/templates

# Open in browser
# http://localhost:32353 (dev) or http://localhost:32352 (prod)
```

## What's Working

The folder browser now has 3 tabs:
1. **Browse** - Traditional folder navigation
2. **Mani Projects** - Quick-select from mani.yaml projects
3. **Templates** - Built-in and custom session templates

Click any mani project or template → starts a Claude session in that directory.

---

## Next Phase Ideas

From ROADMAP.md Phase 2:
- Workspaces (group sessions by project type)
- Enhanced splits (vertical, grids)
- Session export (MD/JSON/HTML)

From ROADMAP.md Phase 3:
- K8s context display
- Infrastructure status panel
- setupEnv integration
