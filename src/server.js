const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const ClaudeBridge = require('./claude-bridge');
const CodexBridge = require('./codex-bridge');
const AgentBridge = require('./agent-bridge');
const SessionStore = require('./utils/session-store');
const ManiIntegration = require('./utils/mani');
const TemplateStore = require('./utils/template-store');
const WorkspaceStore = require('./utils/workspace-store');
const UsageReader = require('./usage-reader');
const UsageAnalytics = require('./usage-analytics');

class ClaudeCodeWebServer {
  constructor(options = {}) {
    this.port = options.port || 32352;
    this.auth = options.auth;
    this.noAuth = options.noAuth || false;
    this.dev = options.dev || false;
    this.useHttps = options.https || false;
    this.certFile = options.cert;
    this.keyFile = options.key;
    this.folderMode = options.folderMode !== false; // Default to true
    this.selectedWorkingDir = null;
    // Base folder for path validation - use --base-folder option, env var, or default to home
    this.baseFolder = options.baseFolder || process.env.CLAUDE_CODE_WEB_BASE || process.env.HOME || process.cwd();
    // Session duration in hours (default to 5 hours from first message)
    this.sessionDurationHours = parseFloat(process.env.CLAUDE_SESSION_HOURS || options.sessionHours || 5);
    
    this.app = express();
    this.claudeSessions = new Map(); // Persistent sessions (claude, codex, or agent)
    this.webSocketConnections = new Map(); // Maps WebSocket connection ID to session info
    this.claudeBridge = new ClaudeBridge();
    this.codexBridge = new CodexBridge();
    this.agentBridge = new AgentBridge();
    this.sessionStore = new SessionStore();
    this.maniIntegration = new ManiIntegration();
    this.templateStore = new TemplateStore();
    this.workspaceStore = new WorkspaceStore();
    this.usageReader = new UsageReader(this.sessionDurationHours);
    this.usageAnalytics = new UsageAnalytics({
      sessionDurationHours: this.sessionDurationHours,
      plan: options.plan || process.env.CLAUDE_PLAN || 'max20',
      customCostLimit: parseFloat(process.env.CLAUDE_COST_LIMIT || options.customCostLimit || 50.00)
    });
    this.autoSaveInterval = null;
    this.startTime = Date.now(); // Track server start time
    this.isShuttingDown = false; // Flag to prevent duplicate shutdown
    // Commands dropdown removed
    // Assistant aliases (for UI display only)
    this.aliases = {
      claude: options.claudeAlias || process.env.CLAUDE_ALIAS || 'Claude',
      codex: options.codexAlias || process.env.CODEX_ALIAS || 'Codex',
      agent: options.agentAlias || process.env.AGENT_ALIAS || 'Cursor'
    };
    
    this.setupExpress();
    this.loadPersistedSessions();
    this.setupAutoSave();
  }
  
  async loadPersistedSessions() {
    try {
      const sessions = await this.sessionStore.loadSessions();
      this.claudeSessions = sessions;
      if (sessions.size > 0) {
        console.log(`Loaded ${sessions.size} persisted sessions`);
      }
    } catch (error) {
      console.error('Failed to load persisted sessions:', error);
    }
  }
  
  setupAutoSave() {
    // Auto-save sessions every 30 seconds
    this.autoSaveInterval = setInterval(() => {
      this.saveSessionsToDisk();
    }, 30000);
    
    // Also save on process exit
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());
    process.on('beforeExit', () => this.saveSessionsToDisk());
  }
  
  async saveSessionsToDisk() {
    if (this.claudeSessions.size > 0) {
      await this.sessionStore.saveSessions(this.claudeSessions);
    }
  }
  
  async handleShutdown() {
    // Prevent multiple shutdown attempts
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    console.log('\nGracefully shutting down...');
    await this.saveSessionsToDisk();
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    this.close();
    process.exit(0);
  }

  isPathWithinBase(targetPath) {
    try {
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(this.baseFolder);
      return resolvedTarget.startsWith(resolvedBase);
    } catch (error) {
      return false;
    }
  }

  validatePath(targetPath) {
    if (!targetPath) {
      return { valid: false, error: 'Path is required' };
    }
    
    const resolvedPath = path.resolve(targetPath);
    
    if (!this.isPathWithinBase(resolvedPath)) {
      return { 
        valid: false, 
        error: 'Access denied: Path is outside the allowed directory' 
      };
    }
    
    return { valid: true, path: resolvedPath };
  }

  // Strip ANSI escape codes from text
  stripAnsi(text) {
    return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  }

  // Export session in various formats
  exportSession(session, format) {
    const rawOutput = session.outputBuffer.join('');
    const cleanOutput = this.stripAnsi(rawOutput);
    const metadata = {
      sessionId: session.id,
      sessionName: session.name,
      workingDir: session.workingDir,
      agent: session.agent || 'claude',
      createdAt: session.createdAt,
      exportedAt: new Date().toISOString()
    };

    switch (format) {
      case 'json':
        return JSON.stringify({
          metadata,
          output: cleanOutput,
          rawOutput: rawOutput
        }, null, 2);

      case 'html':
        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Session: ${metadata.sessionName}</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    .metadata { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .metadata h2 { margin: 0 0 10px 0; color: #e94560; }
    .metadata p { margin: 5px 0; color: #aaa; }
    .output { background: #0f0f1a; padding: 20px; border-radius: 8px; white-space: pre-wrap; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="metadata">
    <h2>${metadata.sessionName}</h2>
    <p><strong>Working Directory:</strong> ${metadata.workingDir}</p>
    <p><strong>Agent:</strong> ${metadata.agent}</p>
    <p><strong>Created:</strong> ${metadata.createdAt}</p>
    <p><strong>Exported:</strong> ${metadata.exportedAt}</p>
  </div>
  <div class="output">${cleanOutput.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
</body>
</html>`;

      case 'txt':
        return cleanOutput;

      case 'markdown':
      default:
        return `# Session: ${metadata.sessionName}

## Metadata
- **Working Directory:** \`${metadata.workingDir}\`
- **Agent:** ${metadata.agent}
- **Created:** ${metadata.createdAt}
- **Exported:** ${metadata.exportedAt}

## Output

\`\`\`
${cleanOutput}
\`\`\`
`;
    }
  }

  setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve manifest.json with correct MIME type
    this.app.get('/manifest.json', (req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json');
      res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));

    // PWA Icon routes - generate icons dynamically
    const iconSizes = [16, 32, 144, 180, 192, 512];
    iconSizes.forEach(size => {
      this.app.get(`/icon-${size}.png`, (req, res) => {
        const svg = `
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${size}" height="${size}" fill="#1a1a1a" rx="${size * 0.1}"/>
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                  font-family="monospace" font-size="${size * 0.4}px" font-weight="bold" fill="#ff6b00">
              CC
            </text>
          </svg>
        `;
        const svgBuffer = Buffer.from(svg);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(svgBuffer);
      });
    });

    // Auth status endpoint - always accessible
    this.app.get('/auth-status', (req, res) => {
      res.json({ 
        authRequired: !this.noAuth && !!this.auth,
        authenticated: false 
      });
    });

    // Auth verify endpoint - check if token is valid
    this.app.post('/auth-verify', (req, res) => {
      if (this.noAuth || !this.auth) {
        return res.json({ valid: true }); // No auth required
      }
      
      const { token } = req.body;
      const valid = token === this.auth;
      
      if (valid) {
        res.json({ valid: true });
      } else {
        res.status(401).json({ valid: false, error: 'Invalid token' });
      }
    });

    if (!this.noAuth && this.auth) {
      this.app.use((req, res, next) => {
        const token = req.headers.authorization || req.query.token;
        if (token !== `Bearer ${this.auth}` && token !== this.auth) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
      });
    }

    // Commands API removed

    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        claudeSessions: this.claudeSessions.size,
        activeConnections: this.webSocketConnections.size 
      });
    });
    
    // Get session persistence info
    this.app.get('/api/sessions/persistence', async (req, res) => {
      const metadata = await this.sessionStore.getSessionMetadata();
      res.json({
        ...metadata,
        currentSessions: this.claudeSessions.size,
        autoSaveEnabled: true,
        autoSaveInterval: 30000
      });
    });

    // List all Claude sessions
    this.app.get('/api/sessions/list', (req, res) => {
      const sessionList = Array.from(this.claudeSessions.entries()).map(([id, session]) => ({
        id,
        name: session.name,
        created: session.created,
        active: session.active,
        workingDir: session.workingDir,
        connectedClients: session.connections.size,
        lastActivity: session.lastActivity
      }));
      res.json({ sessions: sessionList });
    });

    // Create a new session
    this.app.post('/api/sessions/create', (req, res) => {
      const { name, workingDir } = req.body;
      const sessionId = uuidv4();
      
      // Validate working directory if provided
      let validWorkingDir = this.baseFolder;
      if (workingDir) {
        const validation = this.validatePath(workingDir);
        if (!validation.valid) {
          return res.status(403).json({ 
            error: validation.error,
            message: 'Cannot create session with working directory outside the allowed area' 
          });
        }
        validWorkingDir = validation.path;
      } else if (this.selectedWorkingDir) {
        validWorkingDir = this.selectedWorkingDir;
      }
      
      const session = {
        id: sessionId,
        name: name || `Session ${new Date().toLocaleString()}`,
        created: new Date(),
        lastActivity: new Date(),
        active: false,
        agent: null, // 'claude' | 'codex' when started
        workingDir: validWorkingDir,
        connections: new Set(),
        outputBuffer: [],
        maxBufferSize: 1000
      };
      
      this.claudeSessions.set(sessionId, session);
      
      // Save sessions after creating new one
      this.saveSessionsToDisk();
      
      if (this.dev) {
        console.log(`Created new session: ${sessionId} (${session.name})`);
      }
      
      res.json({ 
        success: true,
        sessionId,
        session: {
          id: sessionId,
          name: session.name,
          workingDir: session.workingDir
        }
      });
    });

    // Get session details
    this.app.get('/api/sessions/:sessionId', (req, res) => {
      const session = this.claudeSessions.get(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      res.json({
        id: session.id,
        name: session.name,
        created: session.created,
        active: session.active,
        workingDir: session.workingDir,
        connectedClients: session.connections.size,
        lastActivity: session.lastActivity
      });
    });

    // Delete a Claude session
    this.app.delete('/api/sessions/:sessionId', (req, res) => {
      const sessionId = req.params.sessionId;
      const session = this.claudeSessions.get(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      // Stop Claude process if running
      if (session.active) {
        this.claudeBridge.stopSession(sessionId);
      }
      
      // Disconnect all WebSocket connections for this session
      session.connections.forEach(wsId => {
        const wsInfo = this.webSocketConnections.get(wsId);
        if (wsInfo && wsInfo.ws.readyState === WebSocket.OPEN) {
          wsInfo.ws.send(JSON.stringify({ 
            type: 'session_deleted',
            message: 'Session has been deleted'
          }));
          wsInfo.ws.close();
        }
      });
      
      this.claudeSessions.delete(sessionId);
      
      // Save sessions after deletion
      this.saveSessionsToDisk();
      
      res.json({ success: true, message: 'Session deleted' });
    });

    this.app.get('/api/config', (req, res) => {
      res.json({ 
        folderMode: this.folderMode,
        selectedWorkingDir: this.selectedWorkingDir,
        baseFolder: this.baseFolder,
        aliases: this.aliases
      });
    });

    this.app.post('/api/create-folder', (req, res) => {
      const { parentPath, folderName } = req.body;
      
      if (!folderName || !folderName.trim()) {
        return res.status(400).json({ message: 'Folder name is required' });
      }
      
      if (folderName.includes('/') || folderName.includes('\\')) {
        return res.status(400).json({ message: 'Invalid folder name' });
      }
      
      const basePath = parentPath || this.baseFolder;
      const fullPath = path.join(basePath, folderName);
      
      // Validate that the parent path and resulting path are within base folder
      const parentValidation = this.validatePath(basePath);
      if (!parentValidation.valid) {
        return res.status(403).json({ 
          message: 'Cannot create folder outside the allowed area' 
        });
      }
      
      const fullValidation = this.validatePath(fullPath);
      if (!fullValidation.valid) {
        return res.status(403).json({ 
          message: 'Cannot create folder outside the allowed area' 
        });
      }
      
      try {
        // Check if folder already exists
        if (fs.existsSync(fullValidation.path)) {
          return res.status(409).json({ message: 'Folder already exists' });
        }
        
        // Create the folder
        fs.mkdirSync(fullValidation.path, { recursive: true });
        
        res.json({
          success: true,
          path: fullValidation.path,
          message: `Folder "${folderName}" created successfully`
        });
      } catch (error) {
        console.error('Failed to create folder:', error);
        res.status(500).json({ 
          message: `Failed to create folder: ${error.message}` 
        });
      }
    });

    this.app.get('/api/folders', (req, res) => {
      const requestedPath = req.query.path || this.baseFolder;
      
      // Validate the requested path
      const validation = this.validatePath(requestedPath);
      if (!validation.valid) {
        return res.status(403).json({ 
          error: validation.error,
          message: 'Access to this directory is not allowed' 
        });
      }
      
      const currentPath = validation.path;
      
      try {
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        const folders = items
          .filter(item => item.isDirectory())
          .filter(item => !item.name.startsWith('.') || req.query.showHidden === 'true')
          .map(item => ({
            name: item.name,
            path: path.join(currentPath, item.name),
            isDirectory: true
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        
        const parentDir = path.dirname(currentPath);
        const canGoUp = this.isPathWithinBase(parentDir) && parentDir !== currentPath;
        
        res.json({
          currentPath,
          parentPath: canGoUp ? parentDir : null,
          folders,
          home: this.baseFolder,
          baseFolder: this.baseFolder
        });
      } catch (error) {
        res.status(403).json({ 
          error: 'Cannot access directory',
          message: error.message 
        });
      }
    });

    this.app.post('/api/set-working-dir', (req, res) => {
      const { path: selectedPath } = req.body;
      
      // Validate the path
      const validation = this.validatePath(selectedPath);
      if (!validation.valid) {
        return res.status(403).json({ 
          error: validation.error,
          message: 'Cannot set working directory outside the allowed area' 
        });
      }
      
      const validatedPath = validation.path;
      
      try {
        if (!fs.existsSync(validatedPath)) {
          return res.status(404).json({ error: 'Directory does not exist' });
        }
        
        const stats = fs.statSync(validatedPath);
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Path is not a directory' });
        }
        
        this.selectedWorkingDir = validatedPath;
        res.json({ 
          success: true, 
          workingDir: this.selectedWorkingDir 
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to set working directory',
          message: error.message
        });
      }
    });

    // Mani integration endpoints
    this.app.get('/api/mani/status', (req, res) => {
      res.json({
        available: this.maniIntegration.isAvailable(),
        configPath: this.maniIntegration.configPath
      });
    });

    this.app.get('/api/mani/projects', (req, res) => {
      try {
        const { tags, search } = req.query;
        const options = {};

        if (tags) {
          options.tags = tags.split(',').map(t => t.trim());
        }
        if (search) {
          options.search = search;
        }

        const projects = this.maniIntegration.getProjects(options);
        res.json({
          success: true,
          projects,
          total: projects.length
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load mani projects',
          message: error.message
        });
      }
    });

    this.app.get('/api/mani/tags', (req, res) => {
      try {
        const tags = this.maniIntegration.getTags();
        res.json({
          success: true,
          tags
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load mani tags',
          message: error.message
        });
      }
    });

    // Template endpoints
    this.app.get('/api/templates', async (req, res) => {
      try {
        const templates = await this.templateStore.getTemplates();
        const builtinTemplates = TemplateStore.BUILTIN_TEMPLATES;
        res.json({
          success: true,
          templates,
          builtin: builtinTemplates
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load templates',
          message: error.message
        });
      }
    });

    this.app.get('/api/templates/frequent', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 5;
        const templates = await this.templateStore.getFrequentTemplates(limit);
        res.json({
          success: true,
          templates
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load frequent templates',
          message: error.message
        });
      }
    });

    this.app.get('/api/templates/:id', async (req, res) => {
      try {
        const template = await this.templateStore.getTemplate(req.params.id);
        if (!template) {
          return res.status(404).json({ error: 'Template not found' });
        }
        res.json({ success: true, template });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get template',
          message: error.message
        });
      }
    });

    this.app.post('/api/templates', async (req, res) => {
      try {
        const template = await this.templateStore.createTemplate(req.body);
        res.json({ success: true, template });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to create template',
          message: error.message
        });
      }
    });

    this.app.put('/api/templates/:id', async (req, res) => {
      try {
        const template = await this.templateStore.updateTemplate(req.params.id, req.body);
        res.json({ success: true, template });
      } catch (error) {
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: 'Failed to update template',
          message: error.message
        });
      }
    });

    this.app.delete('/api/templates/:id', async (req, res) => {
      try {
        await this.templateStore.deleteTemplate(req.params.id);
        res.json({ success: true });
      } catch (error) {
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: 'Failed to delete template',
          message: error.message
        });
      }
    });

    this.app.post('/api/templates/:id/use', async (req, res) => {
      try {
        await this.templateStore.recordUsage(req.params.id);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to record template usage',
          message: error.message
        });
      }
    });

    // Kubernetes context endpoint
    this.app.get('/api/k8s/context', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const context = execSync('kubectl config current-context 2>/dev/null', { encoding: 'utf8' }).trim();
        const namespace = execSync('kubectl config view --minify -o jsonpath="{..namespace}" 2>/dev/null', { encoding: 'utf8' }).trim() || 'default';
        res.json({ success: true, context, namespace });
      } catch (error) {
        res.json({ success: false, context: null, namespace: null, error: 'kubectl not available' });
      }
    });

    // List all K8s contexts
    this.app.get('/api/k8s/contexts', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const output = execSync('kubectl config get-contexts -o name 2>/dev/null', { encoding: 'utf8' });
        const currentContext = execSync('kubectl config current-context 2>/dev/null', { encoding: 'utf8' }).trim();
        const contexts = output.trim().split('\n').filter(Boolean).map(name => ({
          name,
          current: name === currentContext
        }));
        res.json({ success: true, contexts, current: currentContext });
      } catch (error) {
        res.json({ success: false, contexts: [], error: 'kubectl not available' });
      }
    });

    // Switch K8s context
    this.app.post('/api/k8s/context', async (req, res) => {
      try {
        const { context } = req.body;
        if (!context) {
          return res.status(400).json({ error: 'Context name required' });
        }
        const { execSync } = require('child_process');
        execSync(`kubectl config use-context "${context.replace(/"/g, '\\"')}" 2>/dev/null`, { encoding: 'utf8' });
        const namespace = execSync('kubectl config view --minify -o jsonpath="{..namespace}" 2>/dev/null', { encoding: 'utf8' }).trim() || 'default';
        res.json({ success: true, context, namespace });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to switch context', message: error.message });
      }
    });

    // List namespaces in current context
    this.app.get('/api/k8s/namespaces', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const output = execSync('kubectl get namespaces -o jsonpath="{.items[*].metadata.name}" 2>/dev/null', { encoding: 'utf8' });
        const namespaces = output.trim().split(' ').filter(Boolean);
        const currentNs = execSync('kubectl config view --minify -o jsonpath="{..namespace}" 2>/dev/null', { encoding: 'utf8' }).trim() || 'default';
        res.json({ success: true, namespaces, current: currentNs });
      } catch (error) {
        res.json({ success: false, namespaces: [], error: 'kubectl not available' });
      }
    });

    // Switch K8s namespace
    this.app.post('/api/k8s/namespace', async (req, res) => {
      try {
        const { namespace } = req.body;
        if (!namespace) {
          return res.status(400).json({ error: 'Namespace required' });
        }
        const { execSync } = require('child_process');
        execSync(`kubectl config set-context --current --namespace="${namespace.replace(/"/g, '\\"')}" 2>/dev/null`, { encoding: 'utf8' });
        res.json({ success: true, namespace });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to switch namespace', message: error.message });
      }
    });

    // List pods in current namespace
    this.app.get('/api/k8s/pods', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const { namespace } = req.query;
        const nsFlag = namespace ? `-n ${namespace.replace(/[^a-z0-9-]/gi, '')}` : '';
        const output = execSync(`kubectl get pods ${nsFlag} -o json 2>/dev/null`, { encoding: 'utf8' });
        const data = JSON.parse(output);
        const pods = data.items.map(pod => ({
          name: pod.metadata.name,
          namespace: pod.metadata.namespace,
          status: pod.status.phase,
          ready: pod.status.containerStatuses ?
            pod.status.containerStatuses.filter(c => c.ready).length + '/' + pod.status.containerStatuses.length :
            '0/0',
          restarts: pod.status.containerStatuses ?
            pod.status.containerStatuses.reduce((sum, c) => sum + c.restartCount, 0) : 0,
          containers: pod.spec.containers.map(c => c.name)
        }));
        res.json({ success: true, pods });
      } catch (error) {
        res.json({ success: false, pods: [], error: error.message });
      }
    });

    // Get pod logs
    this.app.get('/api/k8s/pods/:name/logs', async (req, res) => {
      try {
        const { spawn } = require('child_process');
        const { name } = req.params;
        const { namespace, container, tail = '100', follow } = req.query;

        // Sanitize inputs
        const safeName = name.replace(/[^a-z0-9-]/gi, '');
        const safeNs = namespace ? namespace.replace(/[^a-z0-9-]/gi, '') : 'default';
        const safeContainer = container ? container.replace(/[^a-z0-9-]/gi, '') : '';
        const safeTail = parseInt(tail) || 100;

        if (follow === 'true') {
          // Streaming logs via SSE
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const args = ['logs', '-f', `--tail=${safeTail}`, '-n', safeNs, safeName];
          if (safeContainer) args.push('-c', safeContainer);

          const proc = spawn('kubectl', args);

          proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
              if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
            });
          });

          proc.stderr.on('data', (data) => {
            res.write(`data: ${JSON.stringify({ error: data.toString() })}\n\n`);
          });

          proc.on('close', () => {
            res.write('data: {"done": true}\n\n');
            res.end();
          });

          req.on('close', () => {
            proc.kill();
          });
        } else {
          // One-time fetch
          const { execSync } = require('child_process');
          const args = ['logs', `--tail=${safeTail}`, '-n', safeNs, safeName];
          if (safeContainer) args.push('-c', safeContainer);

          const logs = execSync(`kubectl ${args.join(' ')} 2>/dev/null`, { encoding: 'utf8' });
          res.json({ success: true, logs });
        }
      } catch (error) {
        res.json({ success: false, logs: '', error: error.message });
      }
    });

    // Docker status endpoint
    this.app.get('/api/docker/status', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const version = execSync('docker info --format "{{.ServerVersion}}" 2>/dev/null', { encoding: 'utf8' }).trim();
        const containersRunning = parseInt(execSync('docker info --format "{{.ContainersRunning}}" 2>/dev/null', { encoding: 'utf8' }).trim()) || 0;
        const containersPaused = parseInt(execSync('docker info --format "{{.ContainersPaused}}" 2>/dev/null', { encoding: 'utf8' }).trim()) || 0;
        const containersStopped = parseInt(execSync('docker info --format "{{.ContainersStopped}}" 2>/dev/null', { encoding: 'utf8' }).trim()) || 0;
        res.json({
          success: true,
          version,
          containers: { running: containersRunning, paused: containersPaused, stopped: containersStopped }
        });
      } catch (error) {
        res.json({ success: false, error: 'Docker not available' });
      }
    });

    // List Docker containers
    this.app.get('/api/docker/containers', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const { all } = req.query;
        const flag = all === 'true' ? '-a' : '';
        const output = execSync(`docker ps ${flag} --format '{{json .}}' 2>/dev/null`, { encoding: 'utf8' });
        const containers = output.trim().split('\n').filter(Boolean).map(line => {
          const c = JSON.parse(line);
          return {
            id: c.ID,
            name: c.Names,
            image: c.Image,
            status: c.Status,
            state: c.State,
            ports: c.Ports,
            created: c.CreatedAt
          };
        });
        res.json({ success: true, containers });
      } catch (error) {
        res.json({ success: false, containers: [], error: error.message });
      }
    });

    // Docker container actions (start/stop/restart)
    this.app.post('/api/docker/containers/:id/:action', async (req, res) => {
      try {
        const { execSync } = require('child_process');
        const { id, action } = req.params;
        const safeId = id.replace(/[^a-z0-9_-]/gi, '');
        const validActions = ['start', 'stop', 'restart', 'pause', 'unpause'];

        if (!validActions.includes(action)) {
          return res.status(400).json({ error: 'Invalid action' });
        }

        execSync(`docker ${action} ${safeId} 2>/dev/null`, { encoding: 'utf8' });
        res.json({ success: true, action, containerId: safeId });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Docker container logs
    this.app.get('/api/docker/containers/:id/logs', async (req, res) => {
      try {
        const { id } = req.params;
        const { tail = '100', follow } = req.query;
        const safeId = id.replace(/[^a-z0-9_-]/gi, '');
        const safeTail = parseInt(tail) || 100;

        if (follow === 'true') {
          // Streaming logs via SSE
          const { spawn } = require('child_process');
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const proc = spawn('docker', ['logs', '-f', '--tail', String(safeTail), safeId]);

          proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
              if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
            });
          });

          proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
              if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
            });
          });

          proc.on('close', () => {
            res.write('data: {"done": true}\n\n');
            res.end();
          });

          req.on('close', () => {
            proc.kill();
          });
        } else {
          const { execSync } = require('child_process');
          const logs = execSync(`docker logs --tail ${safeTail} ${safeId} 2>&1`, { encoding: 'utf8' });
          res.json({ success: true, logs });
        }
      } catch (error) {
        res.json({ success: false, logs: '', error: error.message });
      }
    });

    // Terraform status endpoint
    this.app.get('/api/terraform/status', async (req, res) => {
      const { path: workingDir } = req.query;
      if (!workingDir) {
        return res.status(400).json({ error: 'Working directory required' });
      }
      try {
        const fs = require('fs').promises;
        const path = require('path');

        // Check for .tf files
        const files = await fs.readdir(workingDir);
        const tfFiles = files.filter(f => f.endsWith('.tf'));

        if (tfFiles.length === 0) {
          return res.json({ success: true, hasTerraform: false });
        }

        // Check for terraform state
        const hasState = files.includes('terraform.tfstate') || files.includes('.terraform');

        // Get workspace
        let workspace = 'default';
        try {
          const { execSync } = require('child_process');
          workspace = execSync('terraform workspace show 2>/dev/null', { cwd: workingDir, encoding: 'utf8' }).trim();
        } catch (e) {
          // Ignore workspace errors
        }

        res.json({
          success: true,
          hasTerraform: true,
          tfFiles: tfFiles.length,
          hasState,
          workspace
        });
      } catch (error) {
        res.json({ success: false, error: error.message });
      }
    });

    // List Terraform workspaces
    this.app.get('/api/terraform/workspaces', async (req, res) => {
      const { path: workingDir } = req.query;
      if (!workingDir) {
        return res.status(400).json({ error: 'Working directory required' });
      }
      try {
        const { execSync } = require('child_process');
        const output = execSync('terraform workspace list 2>/dev/null', { cwd: workingDir, encoding: 'utf8' });
        const workspaces = output.trim().split('\n').map(line => {
          const isCurrent = line.startsWith('*');
          return {
            name: line.replace(/^\*?\s*/, '').trim(),
            current: isCurrent
          };
        }).filter(w => w.name);
        res.json({ success: true, workspaces });
      } catch (error) {
        res.json({ success: false, workspaces: [], error: error.message });
      }
    });

    // Get Terraform state summary
    this.app.get('/api/terraform/state', async (req, res) => {
      const { path: workingDir } = req.query;
      if (!workingDir) {
        return res.status(400).json({ error: 'Working directory required' });
      }
      try {
        const { execSync } = require('child_process');
        const output = execSync('terraform state list 2>/dev/null', { cwd: workingDir, encoding: 'utf8' });
        const resources = output.trim().split('\n').filter(Boolean).map(resource => {
          const parts = resource.split('.');
          return {
            type: parts.slice(0, -1).join('.'),
            name: parts[parts.length - 1],
            full: resource
          };
        });
        res.json({ success: true, resources, count: resources.length });
      } catch (error) {
        res.json({ success: false, resources: [], error: error.message });
      }
    });

    // Git status endpoint for current session working dir
    this.app.get('/api/git/status', async (req, res) => {
      const { path: workingDir } = req.query;
      if (!workingDir) {
        return res.status(400).json({ error: 'Working directory required' });
      }
      try {
        const { execSync } = require('child_process');
        const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: workingDir, encoding: 'utf8' }).trim();
        const status = execSync('git status --porcelain 2>/dev/null', { cwd: workingDir, encoding: 'utf8' });
        const modified = status.split('\n').filter(l => l.trim()).length;
        res.json({ success: true, branch, modified, isRepo: true });
      } catch (error) {
        res.json({ success: false, isRepo: false });
      }
    });

    // Workspace endpoints
    this.app.get('/api/workspaces', async (req, res) => {
      try {
        const workspaces = await this.workspaceStore.getWorkspaces();
        res.json({ success: true, workspaces });
      } catch (error) {
        res.status(500).json({ error: 'Failed to load workspaces', message: error.message });
      }
    });

    this.app.post('/api/workspaces', async (req, res) => {
      try {
        const workspace = await this.workspaceStore.createWorkspace(req.body);
        res.json({ success: true, workspace });
      } catch (error) {
        res.status(500).json({ error: 'Failed to create workspace', message: error.message });
      }
    });

    this.app.put('/api/workspaces/:id', async (req, res) => {
      try {
        const workspace = await this.workspaceStore.updateWorkspace(req.params.id, req.body);
        res.json({ success: true, workspace });
      } catch (error) {
        res.status(500).json({ error: 'Failed to update workspace', message: error.message });
      }
    });

    this.app.delete('/api/workspaces/:id', async (req, res) => {
      try {
        await this.workspaceStore.deleteWorkspace(req.params.id);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: 'Failed to delete workspace', message: error.message });
      }
    });

    this.app.post('/api/workspaces/:id/sessions/:sessionId', async (req, res) => {
      try {
        const workspace = await this.workspaceStore.addSessionToWorkspace(req.params.id, req.params.sessionId);
        res.json({ success: true, workspace });
      } catch (error) {
        res.status(500).json({ error: 'Failed to add session to workspace', message: error.message });
      }
    });

    this.app.delete('/api/workspaces/:id/sessions/:sessionId', async (req, res) => {
      try {
        const workspace = await this.workspaceStore.removeSessionFromWorkspace(req.params.id, req.params.sessionId);
        res.json({ success: true, workspace });
      } catch (error) {
        res.status(500).json({ error: 'Failed to remove session from workspace', message: error.message });
      }
    });

    // Save workspace layout
    this.app.put('/api/workspaces/:id/layout', async (req, res) => {
      try {
        const { layout } = req.body;
        const workspace = await this.workspaceStore.updateWorkspace(req.params.id, { layout });
        res.json({ success: true, workspace });
      } catch (error) {
        res.status(500).json({ error: 'Failed to save workspace layout', message: error.message });
      }
    });

    // Session export endpoint
    this.app.get('/api/sessions/:sessionId/export', (req, res) => {
      try {
        const { sessionId } = req.params;
        const { format = 'markdown' } = req.query;

        const session = this.claudeSessions.get(sessionId);
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        const exportData = this.exportSession(session, format);

        // Set appropriate headers based on format
        const filename = `session-${session.name || sessionId}-${new Date().toISOString().split('T')[0]}`;

        switch (format) {
          case 'json':
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            break;
          case 'html':
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
            break;
          case 'txt':
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
            break;
          case 'markdown':
          default:
            res.setHeader('Content-Type', 'text/markdown');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
        }

        res.send(exportData);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to export session',
          message: error.message
        });
      }
    });

    this.app.post('/api/folders/select', (req, res) => {
      try {
        const { path: selectedPath } = req.body;
        
        // Validate the path
        const validation = this.validatePath(selectedPath);
        if (!validation.valid) {
          return res.status(403).json({ 
            error: validation.error,
            message: 'Cannot select directory outside the allowed area' 
          });
        }
        
        const validatedPath = validation.path;
        
        // Verify the path exists and is a directory
        if (!fs.existsSync(validatedPath) || !fs.statSync(validatedPath).isDirectory()) {
          return res.status(400).json({ 
            error: 'Invalid directory path' 
          });
        }
        
        // Store the selected working directory
        this.selectedWorkingDir = validatedPath;
        
        res.json({ 
          success: true,
          workingDir: this.selectedWorkingDir
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to set working directory',
          message: error.message 
        });
      }
    });

    this.app.post('/api/close-session', (req, res) => {
      try {
        // Clear the selected working directory
        this.selectedWorkingDir = null;
        
        res.json({ 
          success: true,
          message: 'Working directory cleared'
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to clear working directory',
          message: error.message 
        });
      }
    });

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  async start() {
    let server;
    
    if (this.useHttps) {
      if (!this.certFile || !this.keyFile) {
        throw new Error('HTTPS requires both --cert and --key options');
      }
      
      const cert = fs.readFileSync(this.certFile);
      const key = fs.readFileSync(this.keyFile);
      server = https.createServer({ cert, key }, this.app);
    } else {
      server = http.createServer(this.app);
    }

    this.wss = new WebSocket.Server({ 
      server,
      verifyClient: (info) => {
        if (!this.noAuth && this.auth) {
          const url = new URL(info.req.url, 'ws://localhost');
          const token = url.searchParams.get('token');
          return token === this.auth;
        }
        return true;
      }
    });

    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    return new Promise((resolve, reject) => {
      server.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          this.server = server;
          resolve(server);
        }
      });
    });
  }

  handleWebSocketConnection(ws, req) {
    const wsId = uuidv4(); // Unique ID for this WebSocket connection
    const url = new URL(req.url, `ws://localhost`);
    const claudeSessionId = url.searchParams.get('sessionId');
    
    if (this.dev) {
      console.log(`New WebSocket connection: ${wsId}`);
      if (claudeSessionId) {
        console.log(`Joining Claude session: ${claudeSessionId}`);
      }
    }

    // Store WebSocket connection info
    const wsInfo = {
      id: wsId,
      ws,
      claudeSessionId: null,
      created: new Date()
    };
    this.webSocketConnections.set(wsId, wsInfo);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await this.handleMessage(wsId, data);
      } catch (error) {
        if (this.dev) {
          console.error('Error handling message:', error);
        }
        this.sendToWebSocket(ws, {
          type: 'error',
          message: 'Failed to process message'
        });
      }
    });

    ws.on('close', () => {
      if (this.dev) {
        console.log(`WebSocket connection closed: ${wsId}`);
      }
      this.cleanupWebSocketConnection(wsId);
    });

    ws.on('error', (error) => {
      if (this.dev) {
        console.error(`WebSocket error for connection ${wsId}:`, error);
      }
      this.cleanupWebSocketConnection(wsId);
    });

    // Send initial connection message
    this.sendToWebSocket(ws, {
      type: 'connected',
      connectionId: wsId
    });

    // If sessionId provided, auto-join that session
    if (claudeSessionId && this.claudeSessions.has(claudeSessionId)) {
      this.joinClaudeSession(wsId, claudeSessionId);
    }
  }

  async handleMessage(wsId, data) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    switch (data.type) {
      case 'create_session':
        await this.createAndJoinSession(wsId, data.name, data.workingDir);
        break;

      case 'join_session':
        await this.joinClaudeSession(wsId, data.sessionId);
        break;

      case 'leave_session':
        await this.leaveClaudeSession(wsId);
        break;

      case 'start_claude':
        await this.startClaude(wsId, data.options || {});
        break;
      case 'start_codex':
        await this.startCodex(wsId, data.options || {});
        break;
      case 'start_agent':
        await this.startAgent(wsId, data.options || {});
        break;
      
      case 'input':
        if (wsInfo.claudeSessionId) {
          // Verify the session exists and the WebSocket is part of it
          const session = this.claudeSessions.get(wsInfo.claudeSessionId);
          if (session && session.connections.has(wsId)) {
            // Only send if an agent is running in this session
            if (session.active && session.agent) {
              try {
                if (session.agent === 'codex') {
                  await this.codexBridge.sendInput(wsInfo.claudeSessionId, data.data);
                } else if (session.agent === 'agent') {
                  await this.agentBridge.sendInput(wsInfo.claudeSessionId, data.data);
                } else {
                  await this.claudeBridge.sendInput(wsInfo.claudeSessionId, data.data);
                }
              } catch (error) {
                if (this.dev) {
                  console.error(`Failed to send input to session ${wsInfo.claudeSessionId}:`, error.message);
                }
                this.sendToWebSocket(wsInfo.ws, {
                  type: 'error',
                  message: 'Agent is not running in this session. Please start an agent first.'
                });
              }
            } else {
              this.sendToWebSocket(wsInfo.ws, {
                type: 'info',
                message: 'No agent is running. Choose an option to start.'
              });
            }
          }
        }
        break;
      
      case 'resize':
        if (wsInfo.claudeSessionId) {
          // Verify the session exists and the WebSocket is part of it
          const session = this.claudeSessions.get(wsInfo.claudeSessionId);
          if (session && session.connections.has(wsId)) {
            // Only resize if an agent is actually running
            if (session.active && session.agent) {
              try {
                if (session.agent === 'codex') {
                  await this.codexBridge.resize(wsInfo.claudeSessionId, data.cols, data.rows);
                } else if (session.agent === 'agent') {
                  await this.agentBridge.resize(wsInfo.claudeSessionId, data.cols, data.rows);
                } else {
                  await this.claudeBridge.resize(wsInfo.claudeSessionId, data.cols, data.rows);
                }
              } catch (error) {
                if (this.dev) {
                  console.log(`Resize ignored - agent not active in session ${wsInfo.claudeSessionId}`);
                }
              }
            }
          }
        }
        break;
      
      case 'stop':
        if (wsInfo.claudeSessionId) {
          const session = this.claudeSessions.get(wsInfo.claudeSessionId);
          if (session?.agent === 'codex') {
            await this.stopCodex(wsInfo.claudeSessionId);
          } else if (session?.agent === 'agent') {
            await this.stopAgent(wsInfo.claudeSessionId);
          } else {
            await this.stopClaude(wsInfo.claudeSessionId);
          }
        }
        break;

      case 'ping':
        this.sendToWebSocket(wsInfo.ws, { type: 'pong' });
        break;

      case 'get_usage':
        this.handleGetUsage(wsInfo);
        break;

      default:
        if (this.dev) {
          console.log(`Unknown message type: ${data.type}`);
        }
    }
  }

  async createAndJoinSession(wsId, name, workingDir) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    // Validate working directory if provided
    let validWorkingDir = this.baseFolder;
    if (workingDir) {
      const validation = this.validatePath(workingDir);
      if (!validation.valid) {
        this.sendToWebSocket(wsInfo.ws, {
          type: 'error',
          message: 'Cannot create session with working directory outside the allowed area'
        });
        return;
      }
      validWorkingDir = validation.path;
    } else if (this.selectedWorkingDir) {
      validWorkingDir = this.selectedWorkingDir;
    }

    // Create new Claude session
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      name: name || `Session ${new Date().toLocaleString()}`,
      created: new Date(),
      lastActivity: new Date(),
      active: false,
      workingDir: validWorkingDir,
      connections: new Set([wsId]),
      outputBuffer: [],
      sessionStartTime: null, // Will be set when Claude starts
      sessionUsage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalCost: 0,
        models: {}
      },
      maxBufferSize: 1000
    };
    
    this.claudeSessions.set(sessionId, session);
    wsInfo.claudeSessionId = sessionId;
    
    // Save sessions after creating new one
    this.saveSessionsToDisk();
    
    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_created',
      sessionId,
      sessionName: session.name,
      workingDir: session.workingDir
    });
  }

  async joinClaudeSession(wsId, claudeSessionId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    const session = this.claudeSessions.get(claudeSessionId);
    if (!session) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'Session not found'
      });
      return;
    }

    // Leave current session if any
    if (wsInfo.claudeSessionId) {
      await this.leaveClaudeSession(wsId);
    }

    // Join new session
    wsInfo.claudeSessionId = claudeSessionId;
    session.connections.add(wsId);
    session.lastActivity = new Date();
    session.lastAccessed = Date.now();

    // Send session info and replay buffer
    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_joined',
      sessionId: claudeSessionId,
      sessionName: session.name,
      workingDir: session.workingDir,
      active: session.active,
      outputBuffer: session.outputBuffer.slice(-200) // Send last 200 lines
    });

    if (this.dev) {
      console.log(`WebSocket ${wsId} joined Claude session ${claudeSessionId}`);
    }
  }

  async leaveClaudeSession(wsId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) return;

    const session = this.claudeSessions.get(wsInfo.claudeSessionId);
    if (session) {
      session.connections.delete(wsId);
      session.lastActivity = new Date();
    }

    wsInfo.claudeSessionId = null;
    
    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_left'
    });
  }

  async startClaude(wsId, options) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'No session joined'
      });
      return;
    }

    const session = this.claudeSessions.get(wsInfo.claudeSessionId);
    if (!session) return;

    if (session.active) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'An agent is already running in this session'
      });
      return;
    }

    // Capture the session ID to avoid closure issues
    const sessionId = wsInfo.claudeSessionId;
    
    try {
      await this.claudeBridge.startSession(sessionId, {
        workingDir: session.workingDir,
        onOutput: (data) => {
          // Get the current session again to ensure we have the right reference
          const currentSession = this.claudeSessions.get(sessionId);
          if (!currentSession) return;
          
          // Add to buffer
          currentSession.outputBuffer.push(data);
          if (currentSession.outputBuffer.length > currentSession.maxBufferSize) {
            currentSession.outputBuffer.shift();
          }
          
          // Broadcast to all connected clients for THIS specific session
          this.broadcastToSession(sessionId, {
            type: 'output',
            data
          });
        },
        onExit: (code, signal) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
          }
          this.broadcastToSession(sessionId, {
            type: 'exit',
            code,
            signal
          });
        },
        onError: (error) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
          }
          this.broadcastToSession(sessionId, {
            type: 'error',
            message: error.message
          });
        },
        ...options
      });

      session.active = true;
      session.agent = 'claude';
      session.lastActivity = new Date();
      // Set session start time if this is the first time Claude is started in this session
      if (!session.sessionStartTime) {
        session.sessionStartTime = new Date();
      }

      this.broadcastToSession(sessionId, {
        type: 'claude_started',
        sessionId: sessionId
      });

    } catch (error) {
      if (this.dev) {
        console.error(`Error starting Claude in session ${wsInfo.claudeSessionId}:`, error);
      }
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: `Failed to start Claude Code: ${error.message}`
      });
    }
  }

  async stopClaude(claudeSessionId) {
    const session = this.claudeSessions.get(claudeSessionId);
    if (!session || !session.active) return;

    await this.claudeBridge.stopSession(claudeSessionId);
    session.active = false;
    session.agent = null;
    session.lastActivity = new Date();

    this.broadcastToSession(claudeSessionId, {
      type: 'claude_stopped'
    });
  }

  async startCodex(wsId, options) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'No session joined'
      });
      return;
    }

    const session = this.claudeSessions.get(wsInfo.claudeSessionId);
    if (!session) return;

    if (session.active) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'An agent is already running in this session'
      });
      return;
    }

    const sessionId = wsInfo.claudeSessionId;
    try {
      await this.codexBridge.startSession(sessionId, {
        workingDir: session.workingDir,
        onOutput: (data) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (!currentSession) return;
          currentSession.outputBuffer.push(data);
          if (currentSession.outputBuffer.length > currentSession.maxBufferSize) {
            currentSession.outputBuffer.shift();
          }
          this.broadcastToSession(sessionId, { type: 'output', data });
        },
        onExit: (code, signal) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
            currentSession.agent = null;
          }
          this.broadcastToSession(sessionId, { type: 'exit', code, signal });
        },
        onError: (error) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
            currentSession.agent = null;
          }
          this.broadcastToSession(sessionId, { type: 'error', message: error.message });
        },
        ...options
      });

      session.active = true;
      session.agent = 'codex';
      session.lastActivity = new Date();
      if (!session.sessionStartTime) {
        session.sessionStartTime = new Date();
      }

      this.broadcastToSession(sessionId, {
        type: 'codex_started',
        sessionId: sessionId
      });

    } catch (error) {
      if (this.dev) {
        console.error(`Error starting Codex in session ${wsInfo.claudeSessionId}:`, error);
      }
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: `Failed to start Codex Code: ${error.message}`
      });
    }
  }

  async stopCodex(sessionId) {
    const session = this.claudeSessions.get(sessionId);
    if (!session || !session.active) return;
    await this.codexBridge.stopSession(sessionId);
    session.active = false;
    session.agent = null;
    session.lastActivity = new Date();
    this.broadcastToSession(sessionId, { type: 'codex_stopped' });
  }

  async startAgent(wsId, options) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'No session joined'
      });
      return;
    }

    const session = this.claudeSessions.get(wsInfo.claudeSessionId);
    if (!session) return;

    if (session.active) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'An agent is already running in this session'
      });
      return;
    }

    const sessionId = wsInfo.claudeSessionId;
    try {
      await this.agentBridge.startSession(sessionId, {
        workingDir: session.workingDir,
        onOutput: (data) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (!currentSession) return;
          currentSession.outputBuffer.push(data);
          if (currentSession.outputBuffer.length > currentSession.maxBufferSize) {
            currentSession.outputBuffer.shift();
          }
          this.broadcastToSession(sessionId, { type: 'output', data });
        },
        onExit: (code, signal) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
            currentSession.agent = null;
          }
          this.broadcastToSession(sessionId, { type: 'exit', code, signal });
        },
        onError: (error) => {
          const currentSession = this.claudeSessions.get(sessionId);
          if (currentSession) {
            currentSession.active = false;
            currentSession.agent = null;
          }
          this.broadcastToSession(sessionId, { type: 'error', message: error.message });
        },
        ...options
      });

      session.active = true;
      session.agent = 'agent';
      session.lastActivity = new Date();
      if (!session.sessionStartTime) {
        session.sessionStartTime = new Date();
      }

      this.broadcastToSession(sessionId, {
        type: 'agent_started',
        sessionId: sessionId
      });

    } catch (error) {
      if (this.dev) {
        console.error(`Error starting Agent in session ${wsInfo.claudeSessionId}:`, error);
      }
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: `Failed to start Agent: ${error.message}`
      });
    }
  }

  async stopAgent(sessionId) {
    const session = this.claudeSessions.get(sessionId);
    if (!session || !session.active) return;
    await this.agentBridge.stopSession(sessionId);
    session.active = false;
    session.agent = null;
    session.lastActivity = new Date();
    this.broadcastToSession(sessionId, { type: 'agent_stopped' });
  }

  sendToWebSocket(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  broadcastToSession(claudeSessionId, data) {
    const session = this.claudeSessions.get(claudeSessionId);
    if (!session) return;

    session.connections.forEach(wsId => {
      const wsInfo = this.webSocketConnections.get(wsId);
      // Double-check that this WebSocket is actually part of this session
      if (wsInfo && 
          wsInfo.claudeSessionId === claudeSessionId && 
          wsInfo.ws.readyState === WebSocket.OPEN) {
        this.sendToWebSocket(wsInfo.ws, data);
      }
    });
  }

  cleanupWebSocketConnection(wsId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    // Remove from Claude session if joined
    if (wsInfo.claudeSessionId) {
      const session = this.claudeSessions.get(wsInfo.claudeSessionId);
      if (session) {
        session.connections.delete(wsId);
        session.lastActivity = new Date();
        
        // Don't stop Claude if other connections exist
        if (session.connections.size === 0 && this.dev) {
          console.log(`No more connections to session ${wsInfo.claudeSessionId}`);
        }
      }
    }

    this.webSocketConnections.delete(wsId);
  }

  close() {
    // Save sessions before closing
    this.saveSessionsToDisk();
    
    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }
    
    // Stop all sessions
    for (const [sessionId, session] of this.claudeSessions.entries()) {
      if (session.active) {
        if (session.agent === 'codex') {
          this.codexBridge.stopSession(sessionId);
        } else if (session.agent === 'agent') {
          this.agentBridge.stopSession(sessionId);
        } else {
        this.claudeBridge.stopSession(sessionId);
        }
      }
    }
    
    // Clear all data
    this.claudeSessions.clear();
    this.webSocketConnections.clear();
  }

  async handleGetUsage(wsInfo) {
    try {
      // Get usage stats for the current Claude session window
      const currentSessionStats = await this.usageReader.getCurrentSessionStats();
      
      // Get burn rate calculations
      const burnRateData = await this.usageReader.calculateBurnRate(60);
      
      // Get overlapping sessions
      const overlappingSessions = await this.usageReader.detectOverlappingSessions();
      
      // Get 24h stats for additional context
      const dailyStats = await this.usageReader.getUsageStats(24);
      
      // Update analytics with current session data
      if (currentSessionStats && currentSessionStats.sessionStartTime) {
        // Start tracking this session in analytics
        this.usageAnalytics.startSession(
          currentSessionStats.sessionId,
          new Date(currentSessionStats.sessionStartTime)
        );
        
        // Add usage data to analytics
        if (currentSessionStats.totalTokens > 0) {
          this.usageAnalytics.addUsageData({
            tokens: currentSessionStats.totalTokens,
            inputTokens: currentSessionStats.inputTokens,
            outputTokens: currentSessionStats.outputTokens,
            cacheCreationTokens: currentSessionStats.cacheCreationTokens,
            cacheReadTokens: currentSessionStats.cacheReadTokens,
            cost: currentSessionStats.totalCost,
            model: Object.keys(currentSessionStats.models)[0] || 'unknown',
            sessionId: currentSessionStats.sessionId
          });
        }
      }
      
      // Get comprehensive analytics
      const analytics = this.usageAnalytics.getAnalytics();
      
      // Calculate session timer if we have a current session
      let sessionTimer = null;
      if (currentSessionStats && currentSessionStats.sessionStartTime) {
        // Session starts at the hour, not the exact minute
        const startTime = new Date(currentSessionStats.sessionStartTime);
        const now = new Date();
        const elapsedMs = now - startTime;
        
        // Calculate remaining time in session window (5 hours from first message)
        const sessionDurationMs = this.sessionDurationHours * 60 * 60 * 1000;
        const remainingMs = Math.max(0, sessionDurationMs - elapsedMs);
        
        const hours = Math.floor(elapsedMs / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsedMs % (1000 * 60)) / 1000);
        
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        
        sessionTimer = {
          startTime: currentSessionStats.sessionStartTime,
          elapsed: elapsedMs,
          remaining: remainingMs,
          formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
          remainingFormatted: `${String(remainingHours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`,
          hours,
          minutes,
          seconds,
          remainingMs,
          sessionDurationHours: this.sessionDurationHours,
          sessionNumber: currentSessionStats.sessionNumber || 1, // Add session number
          isExpired: remainingMs === 0,
          burnRate: burnRateData.rate,
          burnRateConfidence: burnRateData.confidence,
          depletionTime: analytics.predictions.depletionTime,
          depletionConfidence: analytics.predictions.confidence
        };
      }
      
      this.sendToWebSocket(wsInfo.ws, {
        type: 'usage_update',
        sessionStats: currentSessionStats || {
          requests: 0,
          totalTokens: 0,
          totalCost: 0,
          message: 'No active Claude session'
        },
        dailyStats: dailyStats,
        sessionTimer: sessionTimer,
        analytics: analytics,
        burnRate: burnRateData,
        overlappingSessions: overlappingSessions.length,
        plan: this.usageAnalytics.currentPlan,
        limits: this.usageAnalytics.planLimits[this.usageAnalytics.currentPlan]
      });
      
    } catch (error) {
      console.error('Error getting usage stats:', error);
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'Failed to retrieve usage statistics'
      });
    }
  }

}

async function startServer(options) {
  const server = new ClaudeCodeWebServer(options);
  return await server.start();
}

module.exports = { startServer, ClaudeCodeWebServer };
