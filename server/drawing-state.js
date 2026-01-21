const fs = require('fs');
const path = require('path');

// Persistence configuration
const DATA_DIR = path.join(__dirname, '..', 'data', 'rooms');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

class DrawingState {
  constructor(roomId) {
    this.roomId = roomId;
    this.actions = [];  // All actions with undone flag
    this.actionIdCounter = 0;
    this.maxActions = 1000;
    this.createdAt = new Date();
    this.lastModified = new Date();
  }

  addAction(action) {
    if (!action || typeof action !== 'object') return null;
    
    const newAction = {
      id: ++this.actionIdCounter,
      userId: action.userId,
      type: action.type,
      payload: {
        tool: action.tool,
        color: action.color,
        size: action.size,
        path: action.path,
        startX: action.startX,
        startY: action.startY
      },
      timestamp: new Date(),
      undone: false
    };
    
    this.actions.push(newAction);
    
    // Trim old actions if exceeding max (keep most recent)
    if (this.actions.length > this.maxActions) {
      this.actions = this.actions.slice(-this.maxActions);
    }
    
    this.lastModified = new Date();
    return newAction;
  }

  // Mark most recent non-undone action as undone
  undoGlobal() {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      if (!this.actions[i].undone && this.actions[i].type !== 'clear') {
        this.actions[i].undone = true;
        this.lastModified = new Date();
        return this.actions[i];
      }
    }
    return null;
  }

  // Undo only this user's last action
  undoForUser(userId) {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      if (this.actions[i].userId === userId && 
          !this.actions[i].undone && 
          this.actions[i].type !== 'clear') {
        this.actions[i].undone = true;
        this.lastModified = new Date();
        return this.actions[i];
      }
    }
    return null;
  }

  // Redo most recently undone action
  redoGlobal() {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      if (this.actions[i].undone && this.actions[i].type !== 'clear') {
        this.actions[i].undone = false;
        this.lastModified = new Date();
        return this.actions[i];
      }
    }
    return null;
  }

  clear() {
    this.actions = [];
    this.actionIdCounter = 0;
    this.lastModified = new Date();
  }

  getState() {
    return {
      roomId: this.roomId,
      actions: this.actions,
      actionCount: this.actions.length
    };
  }

  getActiveActions() {
    return this.actions.filter(a => !a.undone);
  }

  toJSON() {
    return {
      roomId: this.roomId,
      actions: this.actions,
      actionIdCounter: this.actionIdCounter,
      createdAt: this.createdAt.toISOString(),
      lastModified: this.lastModified.toISOString()
    };
  }

  static fromJSON(data) {
    const state = new DrawingState(data.roomId);
    state.actions = data.actions || [];
    state.actionIdCounter = data.actionIdCounter || 0;
    state.createdAt = new Date(data.createdAt || Date.now());
    state.lastModified = new Date(data.lastModified || Date.now());
    return state;
  }
}

class DrawingStateManager {
  constructor() {
    this.states = new Map();
  }

  createState(roomId) {
    if (!this.states.has(roomId)) {
      this.states.set(roomId, new DrawingState(roomId));
    }
    return this.states.get(roomId);
  }

  getState(roomId) {
    const state = this.states.get(roomId);
    return state ? state.getState() : null;
  }

  addAction(roomId, action) {
    let state = this.states.get(roomId);
    if (!state) state = this.createState(roomId);
    state.addAction(action);
  }

  clearState(roomId) {
    const state = this.states.get(roomId);
    if (state) {
      state.clear();
      state.addAction({ type: 'clear' });
    }
  }

  undoGlobal(roomId) {
    const state = this.states.get(roomId);
    return state ? state.undoGlobal() : null;
  }

  undoForUser(roomId, userId) {
    const state = this.states.get(roomId);
    return state ? state.undoForUser(userId) : null;
  }

  redoGlobal(roomId) {
    const state = this.states.get(roomId);
    return state ? state.redoGlobal() : null;
  }

  deleteState(roomId) {
    return this.states.delete(roomId);
  }

  getStateCount() {
    return this.states.size;
  }

  getFilePath(roomId) {
    return path.join(DATA_DIR, `${roomId}.json`);
  }

  // Persist to disk (async)
  saveState(roomId) {
    const state = this.states.get(roomId);
    if (!state) return;

    try {
      ensureDataDir();
      const filePath = this.getFilePath(roomId);
      const data = JSON.stringify(state.toJSON(), null, 2);
      
      // Async write to avoid blocking WebSocket handling
      fs.writeFile(filePath, data, 'utf8', (err) => {
        if (err) {
          console.error(`[Persist] Failed to save room ${roomId}:`, err.message);
        } else {
          console.log(`[Persist] Saved room ${roomId} (${state.actions.length} actions)`);
        }
      });
    } catch (err) {
      console.error(`[Persist] Error saving room ${roomId}:`, err.message);
    }
  }

  // Load from disk (sync, called on room join)
  loadState(roomId) {
    try {
      ensureDataDir();
      const filePath = this.getFilePath(roomId);
      
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      const restoredState = DrawingState.fromJSON(parsed);
      
      this.states.set(roomId, restoredState);
      console.log(`[Persist] Loaded room ${roomId} (${restoredState.actions.length} actions)`);
      return true;
    } catch (err) {
      console.error(`[Persist] Failed to load room ${roomId}:`, err.message);
      return false;
    }
  }

  deletePersistedState(roomId) {
    try {
      const filePath = this.getFilePath(roomId);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error(`[Persist] Failed to delete ${roomId}.json:`, err.message);
          } else {
            console.log(`[Persist] Deleted ${roomId}.json`);
          }
        });
      }
    } catch (err) {
      console.error(`[Persist] Error deleting room ${roomId}:`, err.message);
    }
  }
}

module.exports = { DrawingState, DrawingStateManager };
