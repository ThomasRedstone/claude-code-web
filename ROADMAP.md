# Claude Code Web Roadmap

> **Tailored for Tom's workflow with mani, multi-project development, and cloud-native tooling.**

## Development Strategy: Enhance Without Disruption

To safely enhance claude-code-web while actively using it:

### Safe Development Practices

1. **Git branching**: Work on feature branches, keep `main` stable
2. **Run dev instance on different port**: `npm run dev -- --port 32353` while production runs on 32352
3. **Session isolation**: Development sessions stored separately when using different ports
4. **Hot reload**: Dev mode watches file changes - no restart needed for client changes
5. **Backup sessions**: Sessions persist in `~/.claude-code-web/sessions.json` - safe to copy before major changes
6. **Test in parallel**: Keep a stable instance running while testing new features

### Quick Rollback
```bash
# If something breaks
git stash && git checkout main && npm start

# Or keep a stable version tagged
git tag stable-working
# Later: git checkout stable-working
```

---

## Phase 1: Foundation Improvements (Low Risk, High Value)

### 1.1 Mani Integration
> **Leverage your existing 62+ project workflow**

- [ ] **Project Quick-Launch**: Read mani.yaml to list all projects for quick session creation
  - Auto-detect project root from mani configuration
  - Pre-populate session names from mani project descriptions
  - One-click launch Claude session in any mani-managed project

- [ ] **Mani Task Integration**: Run mani tasks directly from claude-code-web
  - `mani run status -p <project>` - Quick project status
  - `mani run install -p <project>` - Install dependencies
  - Surface mani project tags for session organization

**Implementation**: Add `/api/mani/projects` endpoint, parse `~/mani.yaml`

### 1.2 Session Templates (GitHub Issue #20)
> **Quick-launch presets for your common workflows**

- [ ] **Built-in Templates**:
  - Kubernetes debugging (kubectl context, namespace presets)
  - Terraform/Infrastructure (working dir, env vars)
  - Node.js development (with package manager detection)
  - Python development (venv activation)
  - Go development (GOPATH aware)

- [ ] **Custom Templates**: Save any session configuration for reuse
- [ ] **Variable Substitution**: `{{PROJECT_NAME}}`, `{{BRANCH}}`, etc.

### 1.3 Restore Usage Analytics UI
> **The backend exists but UI was disabled in v3.3.0**

- [ ] Re-enable token consumption meter
- [ ] Add burn rate dashboard
- [ ] Cost projection per session
- [ ] Plan limit warnings

---

## Phase 2: Multi-Project Workflow (Medium Effort)

### 2.1 Workspaces (GitHub Issue #17)
> **Organize sessions like your mani project structure**

- [ ] **Workspace Folders**: Group sessions by project type
  - Map to mani tags: `own`, `fork`, `infra`, `web`
  - Persist workspace state

- [ ] **Cloud Sync**: Optional sync to setupEnv or dotfiles repo
- [ ] **Workspace Templates**: Pre-configured session groups per workflow

### 2.2 Enhanced Split View
> **Building on v3.4.0's new split implementation**

- [ ] Vertical splits (currently only horizontal)
- [ ] Grid layouts (2x2, 3x1, etc.)
- [ ] Save/restore split layouts per workspace
- [ ] Keyboard shortcuts (Ctrl+Alt+Arrow to navigate splits)

### 2.3 Session Export (GitHub Issue #14)
> **Archive completed work**

- [ ] Export to Markdown (best for vault/notes integration)
- [ ] Export to JSON (structured, parseable)
- [ ] Export to HTML (shareable)
- [ ] Integration with your engnotes/vault system

---

## Phase 3: DevOps Integration (Cloud-Native Focus)

### 3.1 Kubernetes Context Awareness
> **Leverage your existing k8s workflow**

- [ ] Display current kubectl context/namespace in session header
- [ ] Quick context switcher in UI
- [ ] Pod log streaming integration
- [ ] Helm release status sidebar

### 3.2 Infrastructure Status Panel
> **Quick glance at your cloud state**

- [ ] AWS resource status (EC2, RDS, etc.)
- [ ] Terraform state summary
- [ ] Docker container status
- [ ] Integration with cloudflare-infra monitoring

### 3.3 setupEnv Integration
> **Share configuration with your environment setup**

- [ ] Read environment variables from setupEnv scripts
- [ ] Sync session configs to setupEnv repo
- [ ] Bootstrap new machines with session templates

---

## Phase 4: Collaboration & Teams (Future)

### 4.1 Multi-User Support
- [ ] User authentication beyond single token
- [ ] Session ownership and sharing
- [ ] Role-based access (view-only, full control)
- [ ] Activity indicators (GitHub Issue #18)

### 4.2 Session Recording
- [ ] Record terminal sessions (asciinema-style)
- [ ] Playback with variable speed
- [ ] Share recordings via link
- [ ] Integration with documentation workflows

---

## Phase 5: Architecture Improvements

### 5.1 Plugin System
> **Extend beyond Claude/Codex/Agent**

- [ ] Dynamic bridge loading from plugins directory
- [ ] Plugin API for custom CLI integrations
- [ ] Potential integrations:
  - Local LLMs (Ollama, llama.cpp)
  - Other AI assistants
  - Custom automation scripts

### 5.2 Database Backend
> **Enable scaling and better queries**

- [ ] SQLite for single-server (drop-in replacement)
- [ ] PostgreSQL option for multi-server
- [ ] Session search and filtering
- [ ] Analytics queries

### 5.3 Code Quality
- [ ] Add ESLint + Prettier configuration
- [ ] TypeScript migration (gradual)
- [ ] E2E tests with Playwright
- [ ] Pre-commit hooks via Husky

---

## Open GitHub Issues (From Repository)

| Priority | Issue | Description | Phase |
|----------|-------|-------------|-------|
| High | #12 | Session reconnection loses scroll position | 1 |
| High | #15 | Split-screen view (partially done in v3.4.0) | 2 |
| Medium | #17 | Workspaces - organize sessions | 2 |
| Medium | #20 | Session templates | 1 |
| Medium | #14 | Export session history | 2 |
| Medium | #18 | Activity indicators & notifications | 4 |
| Low | #10 | Dark mode toggle (already dark by default) | - |
| Low | #11 | Keyboard shortcuts | 1 |

### Open PRs
- **#47**: Global tabs + pane stability fix (ready for review)
- **#55-57**: Dependabot security updates

---

## Quick Wins (This Week)

1. **Merge PR #47** - Fixes tab/pane stability issues
2. **Merge dependabot PRs** - Security updates for qs, express, glob, js-yaml
3. **Add mani project listing** - Simple API endpoint, big workflow improvement
4. **Fix reconnection bug (#12)** - High-impact UX fix

---

## Your Workflow-Specific Recommendations

Based on your setup with 62+ projects in mani, Kubernetes/Helm workflows, and multi-language development:

### Highest Value Additions

1. **Mani Integration** - Your projects are already organized; expose that in the UI
2. **Kubernetes Context Display** - You're constantly switching contexts
3. **Session Templates** - Standardize how you launch different project types
4. **Workspaces** - Mirror your mani tags as workspace folders
5. **Markdown Export** - Integrate with your vault/engnotes for session archiving

### Environment Variables to Add

```bash
# In your setupEnv or .bashrc
export CLAUDE_CODE_WEB_PORT=32352
export CLAUDE_CODE_WEB_MANI_CONFIG="$HOME/mani.yaml"
export CLAUDE_CODE_WEB_SESSION_DIR="$HOME/.claude-code-web"
```

---

## Implementation Notes

### File Locations
- **Server**: `src/server.js` - Add new API endpoints here
- **Client**: `src/public/app.js` - UI changes
- **Bridges**: `src/claude-bridge.js` - Template for new CLI integrations
- **Sessions**: `src/utils/session-store.js` - Storage backend

### Key Extension Points
1. **WebSocket messages**: Add new `case` blocks in `handleMessage()` (server.js:644)
2. **Bridge types**: Copy `claude-bridge.js` pattern for new CLIs
3. **Storage backend**: Override `SessionStore` methods for database support
4. **Analytics**: Replace `UsageAnalytics` for custom tracking

---

## Version History Context

| Version | Key Changes |
|---------|-------------|
| v3.4.0 | VS Code-style split view rewrite |
| v3.3.0 | Bug fixes, usage UI disabled |
| v3.2.0 | Cursor Agent support added |
| v3.0.0 | Major refactor |

---

*Last updated: 2026-01-04*
*Generated based on: mani.yaml analysis, ~/own structure, GitHub issues, codebase exploration*
