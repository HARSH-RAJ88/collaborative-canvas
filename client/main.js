import { CanvasManager } from './canvas.js';
import { WebSocketClient } from './websocket.js';

const SHOW_METRICS = true;

class App {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.roomIdDisplay = document.getElementById('room-id');
    this.userCountDisplay = document.getElementById('user-count');
    this.connectionStatus = document.getElementById('connection-status');
    this.cursorsLayer = document.getElementById('cursors-layer');
    
    this.modal = document.getElementById('room-modal');
    this.usernameInput = document.getElementById('username');
    this.roomInput = document.getElementById('room-input');
    this.joinBtn = document.getElementById('join-btn');
    
    this.toolButtons = document.querySelectorAll('.tool-btn');
    this.colorPicker = document.getElementById('color-picker');
    this.colorButtons = document.querySelectorAll('.color-btn');
    this.brushSize = document.getElementById('brush-size');
    this.sizeValue = document.getElementById('size-value');
    this.undoBtn = document.getElementById('undo-btn');
    this.redoBtn = document.getElementById('redo-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.downloadBtn = document.getElementById('download-btn');
    
    // Metrics overlay elements
    this.metricsOverlay = document.getElementById('metrics-overlay');
    this.fpsValue = document.getElementById('fps-value');
    this.latencyValue = document.getElementById('latency-value');
    
    // FPS counter
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
    
    this.canvasManager = new CanvasManager(this.canvas);
    this.wsClient = new WebSocketClient();
    this.remoteCursors = new Map();
    this.userColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    
    this.init();
  }

  init() {
    this.setupToolbar();
    this.setupModal();
    this.setupCanvasCallbacks();
    this.setupWebSocketCallbacks();
    this.setupCursorTracking();
    this.setupKeyboardShortcuts();
    this.setupMetrics();
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ctrl+Z or Cmd+Z = Global Undo (undo anyone's last action)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.wsClient.sendUndoGlobal();
        this.showNotification('Global Undo');
      }
      
      // Ctrl+Shift+Z or Cmd+Shift+Z = Global Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.wsClient.sendRedoGlobal();
        this.showNotification('Global Redo');
      }
      
      // Ctrl+Y = Global Redo (alternative)
      if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !e.shiftKey) {
        e.preventDefault();
        this.wsClient.sendRedoGlobal();
        this.showNotification('Global Redo');
      }
      
      // Alt+Z = My Undo (undo only your own last action)
      if (e.altKey && e.key === 'z' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.wsClient.sendUndoMy();
        this.showNotification('My Undo');
      }
    });
  }
  
  showNotification(message) {
    // Brief visual feedback for undo/redo actions
    const existing = document.querySelector('.undo-notification');
    if (existing) existing.remove();
    
    const notif = document.createElement('div');
    notif.className = 'undo-notification';
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => notif.remove(), 1000);
  }

  setupToolbar() {
    this.toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.canvasManager.setTool(btn.dataset.tool);
      });
    });
    
    this.colorPicker.addEventListener('input', (e) => this.canvasManager.setColor(e.target.value));
    
    this.colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.colorPicker.value = btn.dataset.color;
        this.canvasManager.setColor(btn.dataset.color);
      });
    });
    
    this.brushSize.addEventListener('input', (e) => {
      const size = parseInt(e.target.value);
      this.sizeValue.textContent = `${size}px`;
      this.canvasManager.setSize(size);
    });
    
    this.clearBtn.addEventListener('click', () => {
      if (confirm('Clear canvas for everyone?')) {
        this.canvasManager.clear();
        this.wsClient.sendCanvasClear();
      }
    });
    
    // Toolbar undo/redo buttons use global undo/redo
    this.undoBtn.addEventListener('click', () => {
      this.wsClient.sendUndoGlobal();
      this.showNotification('Global Undo');
    });
    this.redoBtn.addEventListener('click', () => {
      this.wsClient.sendRedoGlobal();
      this.showNotification('Global Redo');
    });
    
    this.downloadBtn.addEventListener('click', () => this.canvasManager.download());
  }

  setupModal() {
    const params = new URLSearchParams(location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) this.roomInput.value = roomFromUrl;
    
    this.joinBtn.addEventListener('click', () => this.joinRoom());
    this.usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.joinRoom(); });
    this.roomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.joinRoom(); });
    
    this.usernameInput.focus();
  }

  async joinRoom() {
    const username = this.usernameInput.value.trim() || 'Anonymous';
    const roomId = this.roomInput.value.trim().toUpperCase() || null;
    
    if (username.length > 20) {
      alert('Username too long (max 20 chars)');
      return;
    }
    
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = 'Joining...';
    this.setStatus('connecting');
    
    try {
      await this.wsClient.connect(username, roomId);
    } catch (err) {
      console.error('Connection failed:', err);
      this.joinBtn.disabled = false;
      this.joinBtn.textContent = 'Join Canvas';
      this.setStatus('disconnected');
      alert(err.message || 'Failed to connect');
    }
  }

  setupCanvasCallbacks() {
    // Wire up latency callback for adaptive batching
    this.canvasManager.getLatency = () => this.wsClient.getLatency();
    
    // Drawing event callbacks
    this.canvasManager.onDrawStart = (data) => this.wsClient.sendDrawStart(data);
    this.canvasManager.onDrawMove = (data) => this.wsClient.sendDrawMove(data);
    this.canvasManager.onDrawBatch = (moves) => this.wsClient.sendDrawBatch(moves);
    this.canvasManager.onDrawEnd = (data) => this.wsClient.sendDrawEnd(data);
  }

  setupWebSocketCallbacks() {
    this.wsClient.onConnect = () => this.setStatus('connecting');
    this.wsClient.onDisconnect = () => this.setStatus('disconnected');
    
    // Update latency display when RTT changes
    this.wsClient.onLatencyUpdate = (latency) => {
      this.updateLatencyDisplay(latency);
    };
    
    this.wsClient.onRoomJoined = (data) => {
      this.modal.classList.add('hidden');
      this.setStatus('connected');
      this.roomIdDisplay.textContent = `Room: ${data.roomId}`;
      this.userCountDisplay.textContent = `Users: ${data.users.length}`;
      
      // Update URL
      const url = new URL(location);
      url.searchParams.set('room', data.roomId);
      history.replaceState({}, '', url);
      
      // Create cursors for existing users
      data.users.forEach((user, i) => {
        if (user.id !== data.userId) {
          this.createCursor(user.id, user.username, i);
        }
      });
    };
    
    this.wsClient.onUserJoined = (data) => {
      this.userCountDisplay.textContent = `Users: ${data.userCount}`;
      this.createCursor(data.userId, data.username, this.remoteCursors.size);
    };
    
    this.wsClient.onUserLeft = (data) => {
      this.userCountDisplay.textContent = `Users: ${data.userCount}`;
      this.removeCursor(data.userId);
    };
    
    this.wsClient.onDrawStart = (data) => this.canvasManager.remoteDrawStart(data);
    this.wsClient.onDrawMove = (data) => this.canvasManager.remoteDrawMove(data);
    this.wsClient.onDrawEnd = (data) => this.canvasManager.remoteDrawEnd(data);
    this.wsClient.onCursorMove = (data) => this.updateCursor(data.userId, data.x, data.y);
    this.wsClient.onCanvasClear = () => this.canvasManager.clear(false);
    this.wsClient.onCanvasRebuild = (state) => this.canvasManager.rebuild(state);
    this.wsClient.onStateSync = (state) => this.canvasManager.applyState(state);
  }

  setupCursorTracking() {
    let lastUpdate = 0;
    this.canvas.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastUpdate < 50) return;
      lastUpdate = now;
      
      const rect = this.canvas.getBoundingClientRect();
      this.wsClient.sendCursorMove(e.clientX - rect.left, e.clientY - rect.top);
    });
  }

  createCursor(userId, username, colorIndex) {
    const cursor = document.createElement('div');
    cursor.className = 'remote-cursor';
    cursor.id = `cursor-${userId}`;
    cursor.style.setProperty('--cursor-color', this.userColors[colorIndex % this.userColors.length]);
    
    const label = document.createElement('span');
    label.className = 'cursor-label';
    label.textContent = username;
    cursor.appendChild(label);
    
    this.cursorsLayer.appendChild(cursor);
    this.remoteCursors.set(userId, cursor);
  }

  updateCursor(userId, x, y) {
    const cursor = this.remoteCursors.get(userId);
    if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  removeCursor(userId) {
    const cursor = this.remoteCursors.get(userId);
    if (cursor) {
      cursor.remove();
      this.remoteCursors.delete(userId);
    }
  }

  setStatus(status) {
    this.connectionStatus.className = `connection-indicator ${status}`;
    const statusText = this.connectionStatus.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting...' }[status];
    }
  }

  setupMetrics() {
    // Show/hide metrics section
    if (SHOW_METRICS) {
      this.metricsOverlay.classList.remove('hidden');
    }
    
    // Listen for latency updates from WebSocket client
    this.wsClient.onLatencyUpdate = (latency) => {
      this.updateMetricsLatency(latency);
    };
    
    // Start FPS counter loop
    this.startFpsCounter();
  }

  startFpsCounter() {
    const updateFps = () => {
      this.frameCount++;
      
      const now = performance.now();
      const elapsed = now - this.lastFpsUpdate;
      
      // Update FPS display once per second
      if (elapsed >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / elapsed);
        this.fpsValue.textContent = this.fps;
        this.frameCount = 0;
        this.lastFpsUpdate = now;
        
        // Color code FPS based on performance
        if (this.fps >= 50) {
          this.fpsValue.style.color = '#4ade80';  // Green: good
        } else if (this.fps >= 30) {
          this.fpsValue.style.color = '#fbbf24';  // Yellow: acceptable
        } else {
          this.fpsValue.style.color = '#f87171';  // Red: poor
        }
      }
      
      requestAnimationFrame(updateFps);
    };
    
    requestAnimationFrame(updateFps);
  }

  updateMetricsLatency(latency) {
    this.latencyValue.textContent = latency;
    
    // Remove previous color classes
    this.latencyValue.classList.remove('latency-good', 'latency-fair', 'latency-poor');
    
    // Apply color based on latency
    if (latency < 100) {
      this.latencyValue.classList.add('latency-good');
    } else if (latency < 200) {
      this.latencyValue.classList.add('latency-fair');
    } else {
      this.latencyValue.classList.add('latency-poor');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
