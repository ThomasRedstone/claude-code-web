/**
 * SplitContainer - VS Code-style split view with multiple layout options
 * Supports horizontal, vertical, and grid layouts
 */

class Split {
    constructor(container, index, app) {
        this.container = container;
        this.index = index;
        this.app = app;
        this.sessionId = null;
        this.isActive = false;

        // Create independent terminal instance for this split
        this.terminal = null;
        this.fitAddon = null;
        this.webLinksAddon = null;
        this.socket = null;

        this.createTerminal();
    }

    createTerminal() {
        // Create terminal wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'split-terminal-wrapper';

        const terminalDiv = document.createElement('div');
        terminalDiv.id = `split-terminal-${this.index}`;
        wrapper.appendChild(terminalDiv);

        this.container.appendChild(wrapper);

        // Initialize xterm.js terminal
        this.terminal = new Terminal({
            fontFamily: this.app?.terminal?.options?.fontFamily || 'JetBrains Mono, monospace',
            fontSize: this.app?.terminal?.options?.fontSize || 14,
            cursorBlink: true,
            convertEol: true,
            allowProposedApi: true,
            theme: this.app?.terminal?.options?.theme || {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#58a6ff'
            }
        });

        this.fitAddon = new FitAddon.FitAddon();
        this.webLinksAddon = new WebLinksAddon.WebLinksAddon();

        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.webLinksAddon);
        this.terminal.open(terminalDiv);

        // Setup terminal input handler
        this.terminal.onData((data) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Setup resize handler
        this.terminal.onResize(({ cols, rows }) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

        this.fit();
    }

    async setSession(sessionId) {
        if (this.sessionId === sessionId) return;

        // Disconnect from old session
        if (this.socket) {
            this.disconnect();
        }

        this.sessionId = sessionId;

        // Connect to new session
        if (sessionId) {
            await this.connect(sessionId);
        }

        // Update active state
        this.updateActiveState();
    }

    async connect(sessionId) {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let wsUrl = `${protocol}//${location.host}?sessionId=${encodeURIComponent(sessionId)}`;

        // Add auth token if needed
        if (window.authManager) {
            wsUrl = window.authManager.getWebSocketUrl(wsUrl);
        }

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log(`[Split ${this.index}] Connected to session ${sessionId}`);
            // Send initial resize
            const { cols, rows } = this.terminal;
            this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
        };

        this.socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (error) {
                console.error(`[Split ${this.index}] Error handling message:`, error);
            }
        };

        this.socket.onclose = () => {
            console.log(`[Split ${this.index}] Disconnected from session ${sessionId}`);
        };

        this.socket.onerror = (error) => {
            console.error(`[Split ${this.index}] WebSocket error:`, error);
        };
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'output':
                this.terminal.write(msg.data);
                break;

            case 'session_joined':
                // Replay output buffer
                if (msg.outputBuffer && msg.outputBuffer.length > 0) {
                    const joined = msg.outputBuffer.join('');
                    this.terminal.write(joined);
                }
                break;

            case 'claude_started':
            case 'codex_started':
            case 'agent_started':
                console.log(`[Split ${this.index}] Agent started`);
                break;

            case 'exit':
                this.terminal.write('\r\n[Process exited]\r\n');
                break;

            case 'error':
                this.terminal.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
                break;
        }
    }

    disconnect() {
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                // Ignore errors
            }
            this.socket = null;
        }
    }

    fit() {
        try {
            if (this.fitAddon) {
                this.fitAddon.fit();
            }
        } catch (error) {
            // Ignore fit errors
        }
    }

    updateActiveState() {
        if (this.container) {
            if (this.isActive) {
                this.container.classList.add('split-active');
            } else {
                this.container.classList.remove('split-active');
            }
        }
    }

    clear() {
        this.disconnect();
        this.sessionId = null;
        this.isActive = false;
        if (this.terminal) {
            this.terminal.clear();
        }
        this.updateActiveState();
    }

    destroy() {
        this.disconnect();
        if (this.terminal) {
            this.terminal.dispose();
        }
    }
}

// Layout definitions
const LAYOUTS = {
    single: {
        name: 'Single',
        icon: '□',
        cols: 1,
        rows: 1,
        panes: 1
    },
    horizontal: {
        name: 'Side by Side',
        icon: '⬚⬚',
        cols: 2,
        rows: 1,
        panes: 2,
        direction: 'horizontal'
    },
    vertical: {
        name: 'Stacked',
        icon: '⬚\n⬚',
        cols: 1,
        rows: 2,
        panes: 2,
        direction: 'vertical'
    },
    grid2x2: {
        name: '2x2 Grid',
        icon: '⬚⬚\n⬚⬚',
        cols: 2,
        rows: 2,
        panes: 4
    },
    threeColumns: {
        name: '3 Columns',
        icon: '⬚⬚⬚',
        cols: 3,
        rows: 1,
        panes: 3,
        direction: 'horizontal'
    },
    threeRows: {
        name: '3 Rows',
        icon: '⬚\n⬚\n⬚',
        cols: 1,
        rows: 3,
        panes: 3,
        direction: 'vertical'
    }
};

class SplitContainer {
    constructor(app) {
        this.app = app;
        this.enabled = false;
        this.currentLayout = 'single';
        this.splits = [];
        this.activeSplitIndex = 0;
        this.dividerPositions = { h: 50, v: 50 }; // horizontal and vertical divider positions

        // Create layout elements
        this.createLayoutElements();

        // Restore state from localStorage
        this.restoreState();

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    createLayoutElements() {
        const main = document.querySelector('.main');
        if (!main) return;

        // Create split container (initially hidden)
        this.splitContainerEl = document.createElement('div');
        this.splitContainerEl.className = 'split-container';
        this.splitContainerEl.style.display = 'none';

        main.appendChild(this.splitContainerEl);

        // Create layout selector button (top-right of terminal area)
        this.createLayoutSelector();
    }

    createLayoutSelector() {
        const terminalContainer = document.getElementById('terminalContainer');
        if (!terminalContainer) return;

        const selector = document.createElement('div');
        selector.className = 'layout-selector';
        selector.innerHTML = `
            <button class="layout-btn" title="Change Layout (Ctrl+Shift+L)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
            </button>
            <div class="layout-dropdown" style="display: none;">
                ${Object.entries(LAYOUTS).map(([key, layout]) => `
                    <button class="layout-option" data-layout="${key}" title="${layout.name}">
                        <span class="layout-icon">${this.getLayoutIcon(key)}</span>
                        <span class="layout-name">${layout.name}</span>
                    </button>
                `).join('')}
            </div>
        `;

        terminalContainer.appendChild(selector);

        const btn = selector.querySelector('.layout-btn');
        const dropdown = selector.querySelector('.layout-dropdown');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });

        // Handle layout selection
        selector.querySelectorAll('.layout-option').forEach(option => {
            option.addEventListener('click', async (e) => {
                e.stopPropagation();
                const layoutKey = option.dataset.layout;
                await this.setLayout(layoutKey);
                dropdown.style.display = 'none';
            });
        });

        this.layoutSelector = selector;
    }

    getLayoutIcon(layoutKey) {
        const svgs = {
            single: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
            horizontal: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="7" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="7" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
            vertical: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="11" width="16" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
            grid2x2: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="11" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="11" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
            threeColumns: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="4" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="2" width="4" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="2" width="4" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
            threeRows: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="8" width="16" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="14" width="16" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`
        };
        return svgs[layoutKey] || svgs.single;
    }

    async setLayout(layoutKey, sessionIds = []) {
        const layout = LAYOUTS[layoutKey];
        if (!layout) return;

        // Clean up existing splits
        this.cleanupSplits();

        this.currentLayout = layoutKey;

        if (layoutKey === 'single') {
            this.enabled = false;
            this.showSinglePane();
            this.saveState();
            return;
        }

        this.enabled = true;

        // Hide single terminal container
        const terminalContainer = document.getElementById('terminalContainer');
        if (terminalContainer) {
            terminalContainer.style.display = 'none';
        }

        // Build the layout
        this.buildLayout(layout, sessionIds);

        // Show split container
        this.splitContainerEl.style.display = 'flex';

        // Focus first split
        this.activeSplitIndex = 0;
        if (this.splits[0]) {
            this.splits[0].isActive = true;
            this.splits[0].updateActiveState();
        }

        this.saveState();
        console.log(`[SplitContainer] Set layout to ${layoutKey}`);
    }

    buildLayout(layout, sessionIds = []) {
        this.splitContainerEl.innerHTML = '';
        this.splits = [];

        // Set flex direction based on layout
        if (layout.rows > 1 && layout.cols === 1) {
            this.splitContainerEl.style.flexDirection = 'column';
        } else {
            this.splitContainerEl.style.flexDirection = 'row';
        }

        // Handle different layout types
        if (layout.rows === 1) {
            // Single row with multiple columns
            this.buildColumns(layout.cols, sessionIds);
        } else if (layout.cols === 1) {
            // Single column with multiple rows
            this.buildRows(layout.rows, sessionIds);
        } else {
            // Grid layout
            this.buildGrid(layout.rows, layout.cols, sessionIds);
        }

        // Fit all terminals after a short delay
        setTimeout(() => {
            this.splits.forEach(split => split.fit());
        }, 100);
    }

    buildColumns(numCols, sessionIds) {
        const width = 100 / numCols;

        for (let i = 0; i < numCols; i++) {
            const pane = document.createElement('div');
            pane.className = 'split-pane';
            pane.style.width = `${width}%`;
            pane.dataset.splitIndex = String(i);

            if (i > 0) {
                // Add vertical divider
                const divider = this.createDivider('vertical', i - 1);
                this.splitContainerEl.appendChild(divider);
            }

            this.splitContainerEl.appendChild(pane);

            const split = new Split(pane, i, this.app);
            this.splits.push(split);

            // Add close button on non-first panes
            if (i > 0) {
                this.addCloseButton(pane, i);
            }

            // Set session if provided
            if (sessionIds[i]) {
                split.setSession(sessionIds[i]);
            } else if (i === 0 && this.app.currentClaudeSessionId) {
                split.setSession(this.app.currentClaudeSessionId);
            }

            // Click to focus
            pane.addEventListener('click', () => this.focusSplit(i));
        }
    }

    buildRows(numRows, sessionIds) {
        const height = 100 / numRows;

        for (let i = 0; i < numRows; i++) {
            const pane = document.createElement('div');
            pane.className = 'split-pane';
            pane.style.height = `${height}%`;
            pane.style.width = '100%';
            pane.dataset.splitIndex = String(i);

            if (i > 0) {
                // Add horizontal divider
                const divider = this.createDivider('horizontal', i - 1);
                this.splitContainerEl.appendChild(divider);
            }

            this.splitContainerEl.appendChild(pane);

            const split = new Split(pane, i, this.app);
            this.splits.push(split);

            // Add close button on non-first panes
            if (i > 0) {
                this.addCloseButton(pane, i);
            }

            // Set session if provided
            if (sessionIds[i]) {
                split.setSession(sessionIds[i]);
            } else if (i === 0 && this.app.currentClaudeSessionId) {
                split.setSession(this.app.currentClaudeSessionId);
            }

            // Click to focus
            pane.addEventListener('click', () => this.focusSplit(i));
        }
    }

    buildGrid(numRows, numCols, sessionIds) {
        // For grids, we use a different structure: row containers
        this.splitContainerEl.style.flexDirection = 'column';
        const rowHeight = 100 / numRows;
        const colWidth = 100 / numCols;
        let splitIndex = 0;

        for (let row = 0; row < numRows; row++) {
            if (row > 0) {
                // Add horizontal divider between rows
                const hDivider = this.createDivider('horizontal', row - 1);
                hDivider.dataset.row = String(row - 1);
                this.splitContainerEl.appendChild(hDivider);
            }

            const rowContainer = document.createElement('div');
            rowContainer.className = 'split-row';
            rowContainer.style.height = `${rowHeight}%`;
            rowContainer.style.display = 'flex';
            rowContainer.style.flexDirection = 'row';

            for (let col = 0; col < numCols; col++) {
                if (col > 0) {
                    // Add vertical divider
                    const vDivider = this.createDivider('vertical', col - 1);
                    vDivider.dataset.row = String(row);
                    vDivider.dataset.col = String(col - 1);
                    rowContainer.appendChild(vDivider);
                }

                const pane = document.createElement('div');
                pane.className = 'split-pane';
                pane.style.width = `${colWidth}%`;
                pane.dataset.splitIndex = String(splitIndex);
                pane.dataset.row = String(row);
                pane.dataset.col = String(col);

                rowContainer.appendChild(pane);

                const split = new Split(pane, splitIndex, this.app);
                this.splits.push(split);

                // Add close button (except first pane)
                if (splitIndex > 0) {
                    this.addCloseButton(pane, splitIndex);
                }

                // Set session if provided
                if (sessionIds[splitIndex]) {
                    split.setSession(sessionIds[splitIndex]);
                } else if (splitIndex === 0 && this.app.currentClaudeSessionId) {
                    split.setSession(this.app.currentClaudeSessionId);
                }

                // Click to focus
                const idx = splitIndex;
                pane.addEventListener('click', () => this.focusSplit(idx));

                splitIndex++;
            }

            this.splitContainerEl.appendChild(rowContainer);
        }
    }

    createDivider(orientation, index) {
        const divider = document.createElement('div');
        divider.className = `split-divider split-divider-${orientation}`;
        divider.dataset.orientation = orientation;
        divider.dataset.index = String(index);

        this.setupDividerDrag(divider, orientation);
        return divider;
    }

    setupDividerDrag(divider, orientation) {
        let isDragging = false;
        let startPos = 0;
        let startSizes = [];

        divider.addEventListener('mousedown', (e) => {
            isDragging = true;
            startPos = orientation === 'vertical' ? e.clientX : e.clientY;
            document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';

            // Get adjacent panes
            const parent = divider.parentElement;
            const children = Array.from(parent.children).filter(c => c.classList.contains('split-pane') || c.classList.contains('split-row'));
            startSizes = children.map(c => {
                const rect = c.getBoundingClientRect();
                return orientation === 'vertical' ? rect.width : rect.height;
            });

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const currentPos = orientation === 'vertical' ? e.clientX : e.clientY;
            const delta = currentPos - startPos;
            const parent = divider.parentElement;
            const parentRect = parent.getBoundingClientRect();
            const totalSize = orientation === 'vertical' ? parentRect.width : parentRect.height;

            // Find the panes on either side of this divider
            const children = Array.from(parent.children).filter(c => c.classList.contains('split-pane') || c.classList.contains('split-row'));
            const dividerIdx = parseInt(divider.dataset.index);

            if (children[dividerIdx] && children[dividerIdx + 1]) {
                const totalPrev = startSizes.slice(0, dividerIdx + 1).reduce((a, b) => a + b, 0);
                const newLeftSize = Math.max(50, Math.min(totalSize - 50, startSizes[dividerIdx] + delta));
                const newRightSize = Math.max(50, startSizes[dividerIdx + 1] - delta);

                const leftPercent = (newLeftSize / totalSize) * 100;
                const rightPercent = (newRightSize / totalSize) * 100;

                if (orientation === 'vertical') {
                    children[dividerIdx].style.width = `${leftPercent}%`;
                    children[dividerIdx + 1].style.width = `${rightPercent}%`;
                } else {
                    children[dividerIdx].style.height = `${leftPercent}%`;
                    children[dividerIdx + 1].style.height = `${rightPercent}%`;
                }

                // Fit terminals
                this.splits.forEach(split => split.fit());
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                this.saveState();
            }
        });
    }

    addCloseButton(pane, index) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'split-close';
        closeBtn.title = 'Close this pane';
        closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeSplitPane(index);
        });
        pane.appendChild(closeBtn);
    }

    closeSplitPane(index) {
        // If we're down to 2 panes, go back to single
        if (this.splits.length <= 2) {
            this.setLayout('single');
            return;
        }

        // Otherwise, remove this pane and adjust the layout
        // For now, simplify by going to the next smaller layout
        const layout = LAYOUTS[this.currentLayout];
        if (layout.panes === 4) {
            this.setLayout('horizontal');
        } else if (layout.panes === 3) {
            this.setLayout('horizontal');
        } else {
            this.setLayout('single');
        }
    }

    cleanupSplits() {
        this.splits.forEach(split => {
            split.disconnect();
            if (split.terminal) {
                split.terminal.dispose();
            }
        });
        this.splits = [];
        this.splitContainerEl.innerHTML = '';
    }

    showSinglePane() {
        // Hide split container
        this.splitContainerEl.style.display = 'none';

        // Show single terminal container
        const terminalContainer = document.getElementById('terminalContainer');
        if (terminalContainer) {
            terminalContainer.style.display = 'flex';
        }

        // Reconnect main terminal if we have a session
        if (this.app.currentClaudeSessionId) {
            setTimeout(() => {
                this.app.connect();
            }, 100);
        }
    }

    focusSplit(index) {
        if (index < 0 || index >= this.splits.length) return;
        if (this.activeSplitIndex === index) return;

        // Update active state
        this.splits.forEach((split, i) => {
            split.isActive = (i === index);
            split.updateActiveState();
        });

        this.activeSplitIndex = index;

        // Focus the terminal in this split
        const split = this.splits[index];
        if (split.terminal) {
            split.terminal.focus();
        }

        // Update app's current session to match this split
        if (split.sessionId && this.app) {
            this.app.currentClaudeSessionId = split.sessionId;

            // Update tab selection
            if (this.app.sessionTabManager) {
                const tab = this.app.sessionTabManager.tabs.get(split.sessionId);
                if (tab) {
                    this.app.sessionTabManager.tabs.forEach((t, id) => {
                        if (id === split.sessionId) {
                            t.classList.add('active');
                        } else {
                            t.classList.remove('active');
                        }
                    });
                    this.app.sessionTabManager.activeTabId = split.sessionId;
                }
            }
        }

        console.log(`[SplitContainer] Focused split ${index}, session: ${split.sessionId}`);
    }

    // Called when a tab is switched - update the active split's session
    async onTabSwitch(sessionId) {
        if (!this.enabled) return;

        const activeSplit = this.splits[this.activeSplitIndex];
        if (activeSplit) {
            await activeSplit.setSession(sessionId);
        }
    }

    // Legacy method for backward compatibility
    async createSplit(sessionId) {
        if (this.enabled) {
            // If already split, add to next available pane
            const emptySplit = this.splits.find(s => !s.sessionId);
            if (emptySplit) {
                await emptySplit.setSession(sessionId);
                this.focusSplit(emptySplit.index);
            }
            return;
        }

        // Create horizontal split
        await this.setLayout('horizontal', [this.app.currentClaudeSessionId, sessionId]);
    }

    closeSplit() {
        this.setLayout('single');
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+L to open layout selector
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                const dropdown = this.layoutSelector?.querySelector('.layout-dropdown');
                if (dropdown) {
                    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                }
            }

            // Ctrl+\ to toggle split (backward compat)
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault();
                if (this.enabled) {
                    this.setLayout('single');
                } else {
                    this.setLayout('horizontal');
                }
            }

            // Ctrl+1/2/3/4 to focus splits
            if ((e.metaKey || e.ctrlKey) && this.enabled) {
                const num = parseInt(e.key);
                if (num >= 1 && num <= this.splits.length) {
                    e.preventDefault();
                    this.focusSplit(num - 1);
                }
            }
        });
    }

    saveState() {
        try {
            const state = {
                enabled: this.enabled,
                layout: this.currentLayout,
                activeSplitIndex: this.activeSplitIndex,
                sessions: this.splits.map(s => s.sessionId)
            };
            localStorage.setItem('cc-web-splits', JSON.stringify(state));
        } catch (error) {
            console.error('Failed to save split state:', error);
        }
    }

    restoreState() {
        try {
            const saved = localStorage.getItem('cc-web-splits');
            if (!saved) return;

            const state = JSON.parse(saved);

            // Note: Don't auto-restore layout on page load
            // to prevent issues with stale session IDs
            // User can manually recreate layouts
        } catch (error) {
            console.error('Failed to restore split state:', error);
        }
    }

    // Save layout to workspace via API
    async saveLayoutToWorkspace(workspaceId) {
        if (!workspaceId) return;

        try {
            const layoutData = {
                type: this.currentLayout,
                sessions: this.splits.map(s => s.sessionId).filter(Boolean)
            };

            const response = await (window.authFetch || fetch)(`/api/workspaces/${workspaceId}/layout`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ layout: layoutData })
            });

            if (!response.ok) {
                throw new Error('Failed to save layout');
            }

            console.log(`[SplitContainer] Saved layout to workspace ${workspaceId}`);
        } catch (error) {
            console.error('Failed to save layout to workspace:', error);
        }
    }

    // Restore layout from workspace
    async restoreLayoutFromWorkspace(workspace) {
        if (!workspace?.layout) return;

        try {
            const { type, sessions } = workspace.layout;

            // Validate sessions still exist
            const validSessions = [];
            for (const sessionId of sessions) {
                if (sessionId && this.app.sessionTabManager?.tabs.has(sessionId)) {
                    validSessions.push(sessionId);
                }
            }

            if (validSessions.length > 0) {
                await this.setLayout(type, validSessions);
                console.log(`[SplitContainer] Restored layout from workspace ${workspace.id}`);
            }
        } catch (error) {
            console.error('Failed to restore layout from workspace:', error);
        }
    }

    // Get current layout configuration for display
    getLayoutInfo() {
        return {
            layout: this.currentLayout,
            layoutName: LAYOUTS[this.currentLayout]?.name || 'Single',
            paneCount: this.splits.length,
            sessions: this.splits.map(s => s.sessionId)
        };
    }

    // Setup drop zones for drag-to-split
    setupDropZones() {
        const terminalContainer = document.getElementById('terminalContainer');
        if (!terminalContainer) return;

        // Create drop zone indicators for each direction
        const dropZoneRight = document.createElement('div');
        dropZoneRight.className = 'split-drop-zone split-drop-right';
        dropZoneRight.innerHTML = '<span>Split Right</span>';
        dropZoneRight.style.display = 'none';

        const dropZoneBottom = document.createElement('div');
        dropZoneBottom.className = 'split-drop-zone split-drop-bottom';
        dropZoneBottom.innerHTML = '<span>Split Down</span>';
        dropZoneBottom.style.display = 'none';

        terminalContainer.appendChild(dropZoneRight);
        terminalContainer.appendChild(dropZoneBottom);

        // Listen for drag events
        terminalContainer.addEventListener('dragover', (e) => {
            if (this.enabled) return;

            const sessionId = e.dataTransfer?.types?.includes('application/x-session-id') ? 'pending' : null;
            if (!sessionId) return;

            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const rect = terminalContainer.getBoundingClientRect();
            const isNearRightEdge = (e.clientX > rect.right - 100);
            const isNearBottomEdge = (e.clientY > rect.bottom - 100);

            dropZoneRight.style.display = isNearRightEdge ? 'flex' : 'none';
            dropZoneBottom.style.display = isNearBottomEdge && !isNearRightEdge ? 'flex' : 'none';
        });

        terminalContainer.addEventListener('dragleave', (e) => {
            if (!terminalContainer.contains(e.relatedTarget)) {
                dropZoneRight.style.display = 'none';
                dropZoneBottom.style.display = 'none';
            }
        });

        terminalContainer.addEventListener('drop', async (e) => {
            const sessionId = e.dataTransfer?.getData('application/x-session-id');
            dropZoneRight.style.display = 'none';
            dropZoneBottom.style.display = 'none';

            if (!sessionId || sessionId === this.app.currentClaudeSessionId) return;

            const rect = terminalContainer.getBoundingClientRect();
            const isNearRightEdge = (e.clientX > rect.right - 100);
            const isNearBottomEdge = (e.clientY > rect.bottom - 100);

            if (!this.enabled) {
                e.preventDefault();
                if (isNearRightEdge) {
                    await this.setLayout('horizontal', [this.app.currentClaudeSessionId, sessionId]);
                } else if (isNearBottomEdge) {
                    await this.setLayout('vertical', [this.app.currentClaudeSessionId, sessionId]);
                }
            }
        });
    }
}

// Export for use in app.js
window.SplitContainer = SplitContainer;
window.SPLIT_LAYOUTS = LAYOUTS;
