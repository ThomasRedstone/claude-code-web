/**
 * Mani integration utility
 * Parses mani.yaml to provide project listing for quick session creation
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ManiIntegration {
  constructor(options = {}) {
    // Default to ~/mani.yaml, allow override via env or options
    this.configPath = options.configPath ||
                      process.env.CLAUDE_CODE_WEB_MANI_CONFIG ||
                      path.join(process.env.HOME || '/home/tom', 'mani.yaml');
    this.homeDir = process.env.HOME || '/home/tom';
    this.projects = null;
    this.lastLoadTime = 0;
    this.cacheDuration = 30000; // 30 second cache
  }

  /**
   * Load and parse mani.yaml
   * @returns {Object|null} Parsed mani configuration or null if not found
   */
  loadConfig() {
    const now = Date.now();

    // Return cached if still valid
    if (this.projects && (now - this.lastLoadTime) < this.cacheDuration) {
      return this.projects;
    }

    try {
      if (!fs.existsSync(this.configPath)) {
        console.log(`Mani config not found at ${this.configPath}`);
        return null;
      }

      const content = fs.readFileSync(this.configPath, 'utf8');
      const config = yaml.load(content);

      this.projects = config.projects || {};
      this.lastLoadTime = now;

      return this.projects;
    } catch (error) {
      console.error('Failed to load mani config:', error.message);
      return null;
    }
  }

  /**
   * Get list of projects for the UI
   * @param {Object} options - Filter options
   * @param {string[]} options.tags - Filter by tags (e.g., ['own', 'fork'])
   * @param {string} options.search - Search term for name/desc
   * @returns {Array} List of projects with metadata
   */
  getProjects(options = {}) {
    const projects = this.loadConfig();
    if (!projects) {
      return [];
    }

    let result = Object.entries(projects).map(([name, config]) => ({
      name,
      path: config.path ? path.join(this.homeDir, config.path) : null,
      relativePath: config.path || null,
      url: config.url || null,
      tags: config.tags || [],
      description: config.desc || '',
    })).filter(p => p.path); // Only include projects with paths

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      result = result.filter(p =>
        options.tags.some(tag => p.tags.includes(tag))
      );
    }

    // Filter by search term
    if (options.search) {
      const search = options.search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search)
      );
    }

    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }

  /**
   * Get all unique tags from projects
   * @returns {string[]} List of unique tags
   */
  getTags() {
    const projects = this.loadConfig();
    if (!projects) {
      return [];
    }

    const tags = new Set();
    Object.values(projects).forEach(config => {
      (config.tags || []).forEach(tag => tags.add(tag));
    });

    return Array.from(tags).sort();
  }

  /**
   * Check if mani is available
   * @returns {boolean}
   */
  isAvailable() {
    return fs.existsSync(this.configPath);
  }

  /**
   * Get a specific project by name
   * @param {string} name - Project name
   * @returns {Object|null}
   */
  getProject(name) {
    const projects = this.getProjects();
    return projects.find(p => p.name === name) || null;
  }
}

module.exports = ManiIntegration;
