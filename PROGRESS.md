# Development Progress

> Last updated: 2026-01-04 - Phases 1-3 Complete!
> All major enhancements from ROADMAP.md implemented

## Current Status: K8s Integration & Split Layouts Complete

### Commits Made This Session
```
d979d6b feat: add K8s context switcher and pod log streaming
d355ccd feat: add advanced split layouts (vertical, grid, layout selector)
755ee89 feat: add workspaces for session organization
75b0b36 feat: add session export, k8s/git status bar, keyboard shortcuts
aa2e6e4 feat: add session templates for quick-launch presets
5a8b5e3 feat: add mani project integration for quick session creation
47f9ae4 chore(deps): update security dependencies
379fc33 docs: add ROADMAP.md and PROGRESS.md for enhancement tracking
```

---

## Features Implemented

### Phase 1: Foundation

#### 1.1 Mani Integration ✅
- `/api/mani/projects` - List all 62+ projects from ~/mani.yaml
- `/api/mani/tags` - Get project tags (own, fork)
- `/api/mani/status` - Check if mani is available
- "Mani Projects" tab in folder browser with search + tag filter

#### 1.2 Session Templates ✅
- `/api/templates` - CRUD for templates
- Built-in: Node.js, Python, K8s, Terraform, Quick Task
- Custom templates saved to ~/.claude-code-web/templates.json
- "Templates" tab in folder browser

### Phase 2: Multi-Project Workflow

#### 2.1 Workspaces ✅
- `/api/workspaces` - CRUD for workspaces
- Default workspaces: General, Personal Projects, Infrastructure, Web
- Session-to-workspace assignment
- Auto-association with mani tags
- Stored in ~/.claude-code-web/workspaces.json

#### 2.2 Split Layouts ✅
- **Layout Selector** - Click the grid icon in terminal area
- **Available Layouts:**
  - Single (default)
  - Side by Side (horizontal 2-pane)
  - Stacked (vertical 2-pane)
  - 2x2 Grid (4 panes)
  - 3 Columns (3 horizontal panes)
  - 3 Rows (3 vertical panes)
- **Keyboard Shortcuts:**
  - Ctrl+Shift+L: Open layout selector
  - Ctrl+\: Toggle split
  - Ctrl+1/2/3/4: Focus pane by number
- **Drag-to-Split:**
  - Drag session tab to right edge → horizontal split
  - Drag session tab to bottom edge → vertical split
- **Workspace Layout Persistence:**
  - `/api/workspaces/:id/layout` - Save/restore layouts per workspace

#### 2.3 Session Export ✅
- `/api/sessions/:id/export?format=markdown|json|html|txt`
- Ctrl+Shift+E keyboard shortcut
- Downloads file with metadata + cleaned output

### Phase 3: DevOps Integration

#### 3.1 K8s Context Display ✅
- `/api/k8s/context` - Get current kubectl context/namespace
- Status bar shows: `microk8s/default`

#### 3.2 K8s Context Switcher ✅
- Click on K8s status bar item to open switcher modal
- `/api/k8s/contexts` - List all available contexts
- `/api/k8s/namespaces` - List namespaces in current context
- `POST /api/k8s/context` - Switch context
- `POST /api/k8s/namespace` - Switch namespace
- Real-time namespace refresh when switching contexts

#### 3.3 Pod Viewer & Log Streaming ✅
- "View Pods" button in context switcher
- `/api/k8s/pods` - List pods with status, ready count, restarts
- `/api/k8s/pods/:name/logs` - Get pod logs (one-time or streaming)
- Server-Sent Events (SSE) for real-time log following
- Pod status colors: Running (green), Pending (yellow), Failed (red)

#### 3.4 Git Status Display ✅
- `/api/git/status` - Get branch and modified file count
- Status bar shows: `main (3)` for branch + modified count

#### 3.5 Docker Integration ✅
- Docker status in status bar: `running/total` containers
- Click to open container viewer modal
- `/api/docker/status` - Get Docker daemon info
- `/api/docker/containers` - List containers with status
- `/api/docker/containers/:id/:action` - Start/stop/restart containers
- `/api/docker/containers/:id/logs` - View logs (one-time or SSE streaming)
- Container actions: Start, Stop, Restart, View Logs
- Color-coded status: Running (green), Exited (gray), Paused (yellow)

#### Keyboard Shortcuts ✅
- Ctrl+Shift+E: Export session
- Ctrl+K: Clear terminal

---

## File Changes Summary

### New Files Created
```
src/utils/mani.js           - Mani config parser
src/utils/template-store.js - Template storage
src/utils/workspace-store.js - Workspace storage
ROADMAP.md                  - Enhancement roadmap
PROGRESS.md                 - Session tracking
```

### Modified Files
```
src/server.js        - Added 15+ new API endpoints
src/public/app.js    - Added export, status bar, keyboard shortcuts
src/public/index.html - Added status bar, tabs for mani/templates
src/public/style.css  - Added styles for status bar, tabs, templates
package.json          - Updated dependencies
```

---

## API Endpoints Added

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mani/status` | GET | Check mani availability |
| `/api/mani/projects` | GET | List mani projects (search, tags) |
| `/api/mani/tags` | GET | Get available tags |
| `/api/templates` | GET/POST | List/create templates |
| `/api/templates/:id` | GET/PUT/DELETE | Template CRUD |
| `/api/templates/:id/use` | POST | Record template usage |
| `/api/templates/frequent` | GET | Most-used templates |
| `/api/workspaces` | GET/POST | List/create workspaces |
| `/api/workspaces/:id` | PUT/DELETE | Workspace CRUD |
| `/api/workspaces/:id/sessions/:sid` | POST/DELETE | Add/remove session |
| `/api/workspaces/:id/layout` | PUT | Save workspace layout |
| `/api/k8s/context` | GET/POST | Get/switch kubectl context |
| `/api/k8s/contexts` | GET | List all available contexts |
| `/api/k8s/namespaces` | GET | List namespaces in current context |
| `/api/k8s/namespace` | POST | Switch namespace |
| `/api/k8s/pods` | GET | List pods in namespace |
| `/api/k8s/pods/:name/logs` | GET | Get pod logs (supports SSE streaming) |
| `/api/docker/status` | GET | Docker daemon info |
| `/api/docker/containers` | GET | List containers |
| `/api/docker/containers/:id/:action` | POST | Start/stop/restart container |
| `/api/docker/containers/:id/logs` | GET | Container logs (supports SSE) |
| `/api/git/status` | GET | Git branch + modified count |
| `/api/sessions/:id/export` | GET | Export session (md/json/html/txt) |

---

## UI Changes

### Folder Browser (3 tabs)
1. **Browse** - Traditional folder navigation
2. **Mani Projects** - Quick-select from 62+ mani projects
3. **Templates** - Built-in + custom session templates

### Status Bar (new)
- Git branch + modified file count
- K8s context/namespace
- Keyboard shortcut hints

---

## Configuration Files Created

```bash
~/.claude-code-web/
├── sessions.json    # Existing - session data
├── templates.json   # New - custom templates
└── workspaces.json  # New - workspace definitions
```

---

## To Test

```bash
# Start dev server
node bin/cc-web.js --dev --port 32353 --disable-auth --no-open

# Test endpoints
curl http://localhost:32353/api/mani/projects | jq .
curl http://localhost:32353/api/templates | jq .
curl http://localhost:32353/api/workspaces | jq .
curl http://localhost:32353/api/k8s/context | jq .
curl "http://localhost:32353/api/git/status?path=/home/tom/own/claude-code-web" | jq .
```

---

## What's Next (Future Ideas)

### Phase 2 - Completed!
- [x] Vertical splits
- [x] Grid layouts (2x2, 3x1, 3-columns, 3-rows)
- [x] Save/restore split layouts per workspace

### Phase 3 - Complete!
- [x] K8s context switcher UI
- [x] Pod log streaming (with SSE)
- [x] Docker container management
- [ ] Terraform state display - Future
- [ ] AWS status panel - Future

### Phase 4-5 (Future)
- [ ] Multi-user support
- [ ] Session recording/playback
- [ ] Plugin system for custom CLIs
- [ ] Database backend (SQLite/PostgreSQL)
- [ ] TypeScript migration
