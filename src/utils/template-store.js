/**
 * Template Store - Manages session templates for quick launch
 * Templates are saved to ~/.claude-code-web/templates.json
 */

const fs = require('fs').promises;
const path = require('path');

class TemplateStore {
  constructor() {
    this.baseDir = path.join(process.env.HOME || '/home/tom', '.claude-code-web');
    this.filePath = path.join(this.baseDir, 'templates.json');
    this.templates = new Map();
    this.loaded = false;
  }

  async ensureDir() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  async loadTemplates() {
    try {
      await this.ensureDir();
      const data = await fs.readFile(this.filePath, 'utf8');
      const templates = JSON.parse(data);

      this.templates = new Map(
        Array.isArray(templates) ? templates.map(t => [t.id, t]) : []
      );
      this.loaded = true;
      return this.templates;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.templates = new Map();
        this.loaded = true;
        return this.templates;
      }
      throw error;
    }
  }

  async saveTemplates() {
    await this.ensureDir();
    const templates = Array.from(this.templates.values());
    await fs.writeFile(this.filePath, JSON.stringify(templates, null, 2));
  }

  async getTemplates() {
    if (!this.loaded) {
      await this.loadTemplates();
    }
    return Array.from(this.templates.values());
  }

  async getTemplate(id) {
    if (!this.loaded) {
      await this.loadTemplates();
    }
    return this.templates.get(id) || null;
  }

  async createTemplate(template) {
    if (!this.loaded) {
      await this.loadTemplates();
    }

    const id = template.id || this.generateId();
    const newTemplate = {
      id,
      name: template.name || 'Untitled Template',
      workingDir: template.workingDir || null,
      type: template.type || 'claude', // claude, codex, or agent
      options: template.options || {},
      maniProject: template.maniProject || null, // Link to mani project name
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      lastUsed: null
    };

    this.templates.set(id, newTemplate);
    await this.saveTemplates();
    return newTemplate;
  }

  async updateTemplate(id, updates) {
    if (!this.loaded) {
      await this.loadTemplates();
    }

    const existing = this.templates.get(id);
    if (!existing) {
      throw new Error(`Template not found: ${id}`);
    }

    const updated = {
      ...existing,
      ...updates,
      id, // Prevent ID from being changed
      updatedAt: new Date().toISOString()
    };

    this.templates.set(id, updated);
    await this.saveTemplates();
    return updated;
  }

  async deleteTemplate(id) {
    if (!this.loaded) {
      await this.loadTemplates();
    }

    if (!this.templates.has(id)) {
      throw new Error(`Template not found: ${id}`);
    }

    this.templates.delete(id);
    await this.saveTemplates();
    return true;
  }

  async recordUsage(id) {
    if (!this.loaded) {
      await this.loadTemplates();
    }

    const template = this.templates.get(id);
    if (template) {
      template.usageCount = (template.usageCount || 0) + 1;
      template.lastUsed = new Date().toISOString();
      await this.saveTemplates();
    }
  }

  generateId() {
    return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // Get templates sorted by usage (most used first)
  async getFrequentTemplates(limit = 5) {
    const templates = await this.getTemplates();
    return templates
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, limit);
  }

  // Get templates for a specific mani project
  async getTemplatesForProject(projectName) {
    const templates = await this.getTemplates();
    return templates.filter(t => t.maniProject === projectName);
  }
}

// Built-in templates
TemplateStore.BUILTIN_TEMPLATES = [
  {
    id: 'builtin_nodejs',
    name: 'Node.js Project',
    type: 'claude',
    builtin: true,
    options: {},
    description: 'Standard Node.js development session'
  },
  {
    id: 'builtin_python',
    name: 'Python Project',
    type: 'claude',
    builtin: true,
    options: {},
    description: 'Python development session'
  },
  {
    id: 'builtin_kubernetes',
    name: 'Kubernetes Debugging',
    type: 'claude',
    builtin: true,
    options: {},
    description: 'K8s cluster debugging and management'
  },
  {
    id: 'builtin_terraform',
    name: 'Terraform/Infrastructure',
    type: 'claude',
    builtin: true,
    options: {},
    description: 'Infrastructure as code development'
  },
  {
    id: 'builtin_quick',
    name: 'Quick Task',
    type: 'claude',
    builtin: true,
    options: { dangerouslySkipPermissions: true },
    description: 'Fast session with permissions skipped'
  }
];

module.exports = TemplateStore;
