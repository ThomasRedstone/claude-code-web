/**
 * Workspace Store - Manages workspaces for session organization
 * Workspaces group sessions by project type/context
 */

const fs = require('fs').promises;
const path = require('path');

class WorkspaceStore {
  constructor() {
    this.baseDir = path.join(process.env.HOME || '/home/tom', '.claude-code-web');
    this.filePath = path.join(this.baseDir, 'workspaces.json');
    this.workspaces = new Map();
    this.loaded = false;
  }

  async ensureDir() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  async loadWorkspaces() {
    try {
      await this.ensureDir();
      const data = await fs.readFile(this.filePath, 'utf8');
      const workspaces = JSON.parse(data);
      this.workspaces = new Map(
        Array.isArray(workspaces) ? workspaces.map(w => [w.id, w]) : []
      );
      this.loaded = true;
      return this.workspaces;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Initialize with default workspaces
        this.workspaces = new Map(WorkspaceStore.DEFAULT_WORKSPACES.map(w => [w.id, w]));
        this.loaded = true;
        await this.saveWorkspaces();
        return this.workspaces;
      }
      throw error;
    }
  }

  async saveWorkspaces() {
    await this.ensureDir();
    const workspaces = Array.from(this.workspaces.values());
    await fs.writeFile(this.filePath, JSON.stringify(workspaces, null, 2));
  }

  async getWorkspaces() {
    if (!this.loaded) await this.loadWorkspaces();
    return Array.from(this.workspaces.values());
  }

  async getWorkspace(id) {
    if (!this.loaded) await this.loadWorkspaces();
    return this.workspaces.get(id) || null;
  }

  async createWorkspace(workspace) {
    if (!this.loaded) await this.loadWorkspaces();

    const id = workspace.id || this.generateId();
    const newWorkspace = {
      id,
      name: workspace.name || 'New Workspace',
      icon: workspace.icon || '📁',
      color: workspace.color || '#58a6ff',
      sessions: workspace.sessions || [],
      maniTags: workspace.maniTags || [], // Auto-add sessions from these mani tags
      createdAt: new Date().toISOString()
    };

    this.workspaces.set(id, newWorkspace);
    await this.saveWorkspaces();
    return newWorkspace;
  }

  async updateWorkspace(id, updates) {
    if (!this.loaded) await this.loadWorkspaces();

    const existing = this.workspaces.get(id);
    if (!existing) throw new Error(`Workspace not found: ${id}`);

    const updated = { ...existing, ...updates, id };
    this.workspaces.set(id, updated);
    await this.saveWorkspaces();
    return updated;
  }

  async deleteWorkspace(id) {
    if (!this.loaded) await this.loadWorkspaces();
    if (!this.workspaces.has(id)) throw new Error(`Workspace not found: ${id}`);

    this.workspaces.delete(id);
    await this.saveWorkspaces();
    return true;
  }

  async addSessionToWorkspace(workspaceId, sessionId) {
    if (!this.loaded) await this.loadWorkspaces();

    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    if (!workspace.sessions.includes(sessionId)) {
      workspace.sessions.push(sessionId);
      await this.saveWorkspaces();
    }
    return workspace;
  }

  async removeSessionFromWorkspace(workspaceId, sessionId) {
    if (!this.loaded) await this.loadWorkspaces();

    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    workspace.sessions = workspace.sessions.filter(s => s !== sessionId);
    await this.saveWorkspaces();
    return workspace;
  }

  async getWorkspaceForSession(sessionId) {
    if (!this.loaded) await this.loadWorkspaces();

    for (const workspace of this.workspaces.values()) {
      if (workspace.sessions.includes(sessionId)) {
        return workspace;
      }
    }
    return null;
  }

  generateId() {
    return 'ws_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}

// Default workspaces matching common mani tags
WorkspaceStore.DEFAULT_WORKSPACES = [
  {
    id: 'ws_default',
    name: 'General',
    icon: '📁',
    color: '#8b949e',
    sessions: [],
    maniTags: []
  },
  {
    id: 'ws_own',
    name: 'Personal Projects',
    icon: '🏠',
    color: '#58a6ff',
    sessions: [],
    maniTags: ['own']
  },
  {
    id: 'ws_infra',
    name: 'Infrastructure',
    icon: '☁️',
    color: '#f0883e',
    sessions: [],
    maniTags: ['infra']
  },
  {
    id: 'ws_web',
    name: 'Web Projects',
    icon: '🌐',
    color: '#a371f7',
    sessions: [],
    maniTags: ['web']
  }
];

module.exports = WorkspaceStore;
