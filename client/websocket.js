export class WebSocketClient {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.userId = null;
    this.username = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    // Latency measurement for adaptive batching
    this.latency = 50;  // Default assumption (ms)
    this.pingInterval = null;
    this.pingTimestamp = 0;
    this.latencyHistory = [];  // Rolling average
    this.maxLatencyHistory = 5;
    
    // Callbacks
    this.onConnect = null;
    this.onDisconnect = null;
    this.onRoomJoined = null;
    this.onUserJoined = null;
    this.onUserLeft = null;
    this.onDrawStart = null;
    this.onDrawMove = null;
    this.onDrawEnd = null;
    this.onCursorMove = null;
    this.onCanvasClear = null;
    this.onCanvasRebuild = null;
    this.onStateSync = null;
    this.onLatencyUpdate = null;  // New: callback for latency changes
    this.onError = null;
  }

  connect(username, roomId = null) {
    return new Promise((resolve, reject) => {
      if (!username) {
        reject(new Error('Username required'));
        return;
      }
      
      this.username = username.trim().slice(0, 20) || 'Anonymous';
      // Store roomId for reconnect
      if (roomId) this.roomId = roomId;
      
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const port = location.port || (protocol === 'wss:' ? '443' : '3000');
      const url = `${protocol}//${location.hostname}:${port}`;
      
      // Timeout after 10s
      const timeout = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);
      
      try {
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          clearTimeout(timeout);
          console.log('Connected');
          this.reconnectAttempts = 0;
          
          // Join room (use stored roomId for reconnect)
          this.send({ type: 'join-room', roomId: this.roomId, username: this.username });
          
          // Start latency measurement
          this.startLatencyMeasurement();
          
          if (this.onConnect) this.onConnect();
          resolve();
        };
        
        this.ws.onmessage = (e) => this.handleMessage(e.data);
        
        this.ws.onclose = () => {
          console.log('Disconnected');
          this.stopLatencyMeasurement();
          if (this.onDisconnect) this.onDisconnect();
          this.tryReconnect();
        };
        
        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          console.error('WebSocket error');
          if (this.onError) this.onError(err);
          reject(new Error('Connection failed'));
        };
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  startLatencyMeasurement() {
    this.stopLatencyMeasurement();
    // Measure immediately, then every 3 seconds
    this.measureLatency();
    this.pingInterval = setInterval(() => this.measureLatency(), 3000);
  }

  stopLatencyMeasurement() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  measureLatency() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.pingTimestamp = performance.now();
      this.send({ type: 'ping', timestamp: this.pingTimestamp });
    }
  }

  // Rolling average for stability
  updateLatency(rtt) {
    this.latencyHistory.push(rtt);
    if (this.latencyHistory.length > this.maxLatencyHistory) {
      this.latencyHistory.shift();
    }
    
    // Calculate rolling average
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    this.latency = Math.round(sum / this.latencyHistory.length);
    
    if (this.onLatencyUpdate) {
      this.onLatencyUpdate(this.latency);
    }
  }

  getLatency() {
    return this.latency;
  }

  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = 1000 * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.username) {
        // Reconnect to the same room
        this.connect(this.username, this.roomId).catch(err => {
          console.error('Reconnect failed:', err);
        });
      }
    }, delay);
  }

  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      console.error('Invalid message');
      return;
    }
    
    switch (msg.type) {
      case 'pong':
        // Calculate RTT from ping timestamp
        const rtt = performance.now() - this.pingTimestamp;
        this.updateLatency(rtt);
        break;
        
      case 'room-joined':
        this.roomId = msg.roomId;
        this.userId = msg.userId;
        console.log(`Joined room ${msg.roomId} (latency: ${this.latency}ms)`);
        if (this.onRoomJoined) this.onRoomJoined(msg);
        break;
        
      case 'user-joined':
        console.log(`${msg.username} joined`);
        if (this.onUserJoined) this.onUserJoined(msg);
        break;
        
      case 'user-left':
        console.log(`${msg.username} left`);
        if (this.onUserLeft) this.onUserLeft(msg);
        break;
        
      case 'draw-start':
        if (this.onDrawStart && msg.userId !== this.userId) this.onDrawStart(msg);
        break;
        
      case 'draw-move':
        if (this.onDrawMove && msg.userId !== this.userId) this.onDrawMove(msg);
        break;
        
      case 'draw-end':
        if (this.onDrawEnd && msg.userId !== this.userId) this.onDrawEnd(msg);
        break;
        
      case 'cursor-move':
        if (this.onCursorMove && msg.userId !== this.userId) this.onCursorMove(msg);
        break;
        
      case 'canvas-clear':
        if (this.onCanvasClear) this.onCanvasClear();
        break;
        
      case 'canvas-rebuild':
        if (this.onCanvasRebuild) this.onCanvasRebuild(msg.state);
        break;
        
      case 'state-sync':
        if (this.onStateSync) this.onStateSync(msg.state);
        break;
        
      case 'error':
        console.error('Server error:', msg.message);
        if (this.onError) this.onError(new Error(msg.message));
        break;
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  sendDrawStart(data) { this.send({ type: 'draw-start', ...data }); }
  sendDrawMove(data) { this.send({ type: 'draw-move', ...data }); }
  sendDrawBatch(moves) { this.send({ type: 'draw-batch', moves }); }
  sendDrawEnd(data) { this.send({ type: 'draw-end', ...data }); }
  sendCursorMove(x, y) { this.send({ type: 'cursor-move', x, y }); }
  sendCanvasClear() { this.send({ type: 'canvas-clear' }); }
  
  // Undo/Redo commands
  sendUndoGlobal() { this.send({ type: 'undo-global' }); }  // Ctrl+Z
  sendUndoMy() { this.send({ type: 'undo-my' }); }          // Alt+Z
  sendRedoGlobal() { this.send({ type: 'redo-global' }); }  // Ctrl+Shift+Z
  
  // Legacy aliases
  sendUndo() { this.sendUndoGlobal(); }
  sendRedo() { this.sendRedoGlobal(); }

  disconnect() {
    this.stopLatencyMeasurement();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
