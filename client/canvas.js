export class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    this.isDrawing = false;
    this.currentTool = 'brush';
    this.currentColor = '#000000';
    this.brushSize = 5;
    this.startX = 0;
    this.startY = 0;
    this.currentPath = [];
    this.shapeSnapshot = null;
    
    // Snapshot cache for faster undo/redo - replay from nearest snapshot instead of from scratch
    this.snapshotCache = new Map();
    this.snapshotInterval = 15;
    
    // Adaptive batching - sends more/fewer points based on network latency
    this.lastDrawEvent = 0;
    this.pendingDrawData = null;
    this.rafId = null;
    this.moveBatch = [];
    this.getLatency = null;
    
    // Callbacks (set by main.js to hook into network layer)
    this.onDrawStart = null;
    this.onDrawMove = null;
    this.onDrawBatch = null;
    this.onDrawEnd = null;
    
    this.init();
  }
  
  // Returns throttle interval in ms based on current network conditions
  getAdaptiveThrottle() {
    const latency = this.getLatency ? this.getLatency() : 50;
    
    if (latency < 50) return 8;    // Excellent: ~120fps network
    if (latency < 100) return 16;  // Good: ~60fps network
    if (latency < 200) return 32;  // Fair: ~30fps network
    return 50;                      // Poor: ~20fps network, batch more
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', (e) => this.stopDrawing(e));
    this.canvas.addEventListener('mouseleave', (e) => this.stopDrawing(e));
    
    this.canvas.addEventListener('touchstart', (e) => this.startDrawing(e));
    this.canvas.addEventListener('touchmove', (e) => this.draw(e));
    this.canvas.addEventListener('touchend', (e) => this.stopDrawing(e));
    
    // Keyboard undo/redo handled in main.js for global sync
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const temp = document.createElement('canvas');
    temp.width = this.canvas.width;
    temp.height = this.canvas.height;
    temp.getContext('2d').drawImage(this.canvas, 0, 0);
    
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.ctx.drawImage(temp, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  getCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  startDrawing(e) {
    e.preventDefault();
    const { x, y } = this.getCoords(e);
    
    this.isDrawing = true;
    this.startX = x;
    this.startY = y;
    this.currentPath = [{ x, y }];
    
    if (this.isShapeTool()) {
      // Save state for shape preview - restored each frame to avoid ghost trails
      this.shapeSnapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
    
    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.drawDot(x, y);
    }
    
    if (this.onDrawStart) {
      this.onDrawStart({ tool: this.currentTool, color: this.currentColor, size: this.brushSize, x, y });
    }
  }

  draw(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    
    const { x, y } = this.getCoords(e);
    this.currentPath.push({ x, y });
    
    // Draw locally first for instant feedback
    switch (this.currentTool) {
      case 'brush': this.drawBrushStroke(x, y); break;
      case 'eraser': this.drawEraserStroke(x, y); break;
      case 'line': this.previewLine(x, y); break;
      case 'rectangle': this.previewRectangle(x, y); break;
      case 'circle': this.previewCircle(x, y); break;
    }
    
    this.sendDrawMoveAdaptive({ tool: this.currentTool, color: this.currentColor, size: this.brushSize, x, y });
  }
  
  // Adjusts send frequency based on latency - batches more when connection is slow
  sendDrawMoveAdaptive(drawData) {
    if (!this.onDrawMove && !this.onDrawBatch) return;
    
    const throttleMs = this.getAdaptiveThrottle();
    const latency = this.getLatency ? this.getLatency() : 50;
    
    this.pendingDrawData = drawData;
    
    // High latency: batch events together
    if (latency >= 150 && this.onDrawBatch) {
      this.moveBatch.push(drawData);
      
      // Send batch when enough time passed
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          const now = performance.now();
          if (now - this.lastDrawEvent >= throttleMs && this.moveBatch.length > 0) {
            this.onDrawBatch([...this.moveBatch]);
            this.moveBatch = [];
            this.lastDrawEvent = now;
          }
          this.rafId = null;
        });
      }
    } else {
      // Low latency: send individual events
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          const now = performance.now();
          if (now - this.lastDrawEvent >= throttleMs && this.pendingDrawData) {
            this.onDrawMove(this.pendingDrawData);
            this.lastDrawEvent = now;
          }
          this.rafId = null;
        });
      }
    }
  }

  stopDrawing(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    // Flush remaining batched moves
    if (this.moveBatch.length > 0 && this.onDrawBatch) {
      this.onDrawBatch([...this.moveBatch]);
      this.moveBatch = [];
    }
    
    const optimizedPath = this.optimizePath(this.currentPath);
    
    if (this.onDrawEnd) {
      this.onDrawEnd({
        tool: this.currentTool,
        color: this.currentColor,
        size: this.brushSize,
        path: optimizedPath,
        startX: this.startX,
        startY: this.startY
      });
    }
    
    this.currentPath = [];
    this.shapeSnapshot = null;
    this.pendingDrawData = null;
  }

  drawDot(x, y) {
    this.ctx.fillStyle = this.currentTool === 'eraser' ? '#fff' : this.currentColor;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawBrushStroke(x, y) {
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    
    // Smooth strokes via quadratic curves - reduces jagginess from mouse sampling
    if (this.currentPath.length >= 3) {
      const len = this.currentPath.length;
      const p1 = this.currentPath[len - 2];
      const p2 = this.currentPath[len - 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      
      this.ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(midX, midY);
    } else {
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
    }
  }

  drawEraserStroke(x, y) {
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  isShapeTool() {
    return ['line', 'rectangle', 'circle'].includes(this.currentTool);
  }

  previewLine(x, y) {
    this.ctx.putImageData(this.shapeSnapshot, 0, 0);
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.beginPath();
    this.ctx.moveTo(this.startX, this.startY);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
  }

  previewRectangle(x, y) {
    this.ctx.putImageData(this.shapeSnapshot, 0, 0);
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.strokeRect(this.startX, this.startY, x - this.startX, y - this.startY);
  }

  previewCircle(x, y) {
    this.ctx.putImageData(this.shapeSnapshot, 0, 0);
    const radius = Math.sqrt(Math.pow(x - this.startX, 2) + Math.pow(y - this.startY, 2));
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.beginPath();
    this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  // Thin out points that are too close together - saves bandwidth without visible difference
  optimizePath(path, minDistance = 3) {
    if (path.length < 3) return path;
    
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = path[i];
      const dist = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
      if (dist >= minDistance) result.push(curr);
    }
    result.push(path[path.length - 1]);
    return result;
  }

  remoteDrawStart(data) {
    this.ctx.beginPath();
    this.ctx.moveTo(data.x, data.y);
  }

  remoteDrawMove(data) {
    this.ctx.strokeStyle = data.tool === 'eraser' ? '#fff' : data.color;
    this.ctx.lineWidth = data.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineTo(data.x, data.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(data.x, data.y);
  }

  remoteDrawEnd(data) {
    if (!data.path || data.path.length === 0) return;
    
    const path = data.path;
    this.ctx.strokeStyle = data.tool === 'eraser' ? '#fff' : data.color;
    this.ctx.lineWidth = data.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    if (data.tool === 'line') {
      const end = path[path.length - 1];
      this.ctx.beginPath();
      this.ctx.moveTo(data.startX, data.startY);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    } else if (data.tool === 'rectangle') {
      const end = path[path.length - 1];
      this.ctx.strokeRect(data.startX, data.startY, end.x - data.startX, end.y - data.startY);
    } else if (data.tool === 'circle') {
      const end = path[path.length - 1];
      const r = Math.sqrt(Math.pow(end.x - data.startX, 2) + Math.pow(end.y - data.startY, 2));
      this.ctx.beginPath();
      this.ctx.arc(data.startX, data.startY, r, 0, Math.PI * 2);
      this.ctx.stroke();
    } else {
      this.drawRemotePath(path, data.color, data.size, data.tool === 'eraser');
    }
  }

  drawRemotePath(path, color, size, isEraser) {
    if (path.length < 2) return;
    
    this.ctx.strokeStyle = isEraser ? '#fff' : color;
    this.ctx.lineWidth = size;
    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x, path[0].y);
    
    for (let i = 1; i < path.length - 1; i++) {
      const midX = (path[i].x + path[i + 1].x) / 2;
      const midY = (path[i].y + path[i + 1].y) / 2;
      this.ctx.quadraticCurveTo(path[i].x, path[i].y, midX, midY);
    }
    this.ctx.lineTo(path[path.length - 1].x, path[path.length - 1].y);
    this.ctx.stroke();
  }

  applyState(state) {
    if (!state || !state.actions) return;
    for (const action of state.actions) {
      if (!action.undone) {
        this.applyAction(action);
      }
    }
  }

  applyAction(action) {
    if (action.type === 'clear') {
      this.clearCanvas();
      return;
    }
    
    // Handle old format (flat) vs new format (nested in payload)
    const payload = action.payload || action;
    const tool = payload.tool;
    const color = payload.color;
    const size = payload.size;
    const path = payload.path;
    const startX = payload.startX;
    const startY = payload.startY;
    
    this.ctx.strokeStyle = tool === 'eraser' ? '#fff' : color;
    this.ctx.lineWidth = size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    if (!path || path.length === 0) return;
    
    if (tool === 'brush' || tool === 'eraser') {
      this.drawRemotePath(path, color, size, tool === 'eraser');
    } else if (tool === 'line') {
      const end = path[path.length - 1];
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    } else if (tool === 'rectangle') {
      const end = path[path.length - 1];
      this.ctx.strokeRect(startX, startY, end.x - startX, end.y - startY);
    } else if (tool === 'circle') {
      const end = path[path.length - 1];
      const r = Math.sqrt(Math.pow(end.x - startX, 2) + Math.pow(end.y - startY, 2));
      this.ctx.beginPath();
      this.ctx.arc(startX, startY, r, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  setTool(tool) { this.currentTool = tool; }
  setColor(color) { this.currentColor = color; }
  setSize(size) { this.brushSize = size; }

  clearCanvas() {
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.snapshotCache.clear();
  }

  // Redraws entire canvas from server state, using cached snapshots when possible
  rebuild(state) {
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (!state?.actions) return;
    
    const activeActions = state.actions.filter(a => !a.undone);
    if (activeActions.length === 0) return;
    
    let startIndex = 0;
    const snapshotKeys = Array.from(this.snapshotCache.keys()).sort((a, b) => b - a);
    
    for (const key of snapshotKeys) {
      if (key <= activeActions.length) {
        const snapshot = this.snapshotCache.get(key);
        if (snapshot) {
          this.ctx.putImageData(snapshot, 0, 0);
          startIndex = key;
          break;
        }
      }
    }
    
    for (let i = startIndex; i < activeActions.length; i++) {
      this.applyAction(activeActions[i]);
      
      // Cache snapshots periodically for faster future rebuilds
      if ((i + 1) % this.snapshotInterval === 0 && !this.snapshotCache.has(i + 1)) {
        this.snapshotCache.set(i + 1, this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
      }
    }
    
    if (this.snapshotCache.size > 10) {
      const oldestKey = Math.min(...this.snapshotCache.keys());
      this.snapshotCache.delete(oldestKey);
    }
  }

  clear() {
    this.clearCanvas();
  }

  download() {
    const link = document.createElement('a');
    link.download = `canvas-${Date.now()}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }
}
