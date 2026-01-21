const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { RoomManager } = require('./rooms');
const { DrawingStateManager } = require('./drawing-state');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const roomManager = new RoomManager();
const drawingStateManager = new DrawingStateManager();

app.use(express.static(path.join(__dirname, '../client')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: roomManager.getRoomCount(),
    connections: wss.clients.size
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (room) {
    res.json({ roomId: room.id, userCount: room.users.size, createdAt: room.createdAt });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

wss.on('connection', (ws) => {
  console.log('New connection');
  
  ws.id = uuidv4();
  ws.isAlive = true;
  ws.roomId = null;
  ws.username = null;
  
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.on('message', (data) => {
    try {
      handleMessage(ws, JSON.parse(data));
    } catch (err) {
      sendError(ws, 'Invalid JSON');
    }
  });
  
  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});

function handleMessage(ws, msg) {
  if (!msg || !msg.type) {
    sendError(ws, 'Missing type');
    return;
  }
  
  if (!['draw-move', 'cursor-move'].includes(msg.type)) {
    console.log(`[${ws.username || '?'}] ${msg.type}`);
  }
  
  switch (msg.type) {
    case 'join-room':
      handleJoinRoom(ws, msg);
      break;
    case 'draw-start':
    case 'draw-move':
    case 'draw-end':
      handleDrawEvent(ws, msg);
      break;
    case 'draw-batch':
      handleDrawBatch(ws, msg);
      break;
    case 'cursor-move':
      handleCursorMove(ws, msg);
      break;
    case 'canvas-clear':
      handleCanvasClear(ws);
      break;
    case 'ping':
      send(ws, { type: 'pong', timestamp: msg.timestamp });
      break;
    case 'undo-global':
      handleUndoGlobal(ws);
      break;
    case 'undo-my':
      handleUndoMy(ws);
      break;
    case 'redo-global':
      handleRedoGlobal(ws);
      break;
    // Legacy support
    case 'undo':
      handleUndoMy(ws);
      break;
    case 'redo':
      handleRedoGlobal(ws);
      break;
  }
}

function handleJoinRoom(ws, msg) {
  let { roomId, username } = msg;
  
  username = sanitize(username, 20) || 'Anonymous';
  roomId = roomId ? roomId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) : null;
  
  let room;
  let isNewRoom = false;
  
  if (roomId && roomManager.roomExists(roomId)) {
    room = roomManager.getRoom(roomId);
  } else {
    room = roomManager.createRoom(roomId);
    isNewRoom = true;
    
    // Try to load persisted state first, otherwise create new
    const loaded = drawingStateManager.loadState(room.id);
    if (!loaded) {
      drawingStateManager.createState(room.id);
    }
  }
  
  ws.roomId = room.id;
  ws.username = username;
  roomManager.addUser(room.id, ws.id, username, ws);
  
  const users = roomManager.getUsers(room.id);
  
  send(ws, {
    type: 'room-joined',
    roomId: room.id,
    userId: ws.id,
    users: users.map(u => ({ id: u.id, username: u.username }))
  });
  
  const state = drawingStateManager.getState(room.id);
  if (state && state.actions.length > 0) {
    send(ws, { type: 'state-sync', state });
  }
  
  broadcast(room.id, {
    type: 'user-joined',
    userId: ws.id,
    username,
    userCount: users.length
  }, ws.id);
  
  console.log(`${username} joined ${room.id}${isNewRoom ? ' (new room)' : ''}`);
}

function handleDrawEvent(ws, msg) {
  if (!ws.roomId) return;
  if (!isValidDrawData(msg)) return;
  
  msg.userId = ws.id;
  msg.username = ws.username;
  
  if (msg.type === 'draw-end') {
    drawingStateManager.addAction(ws.roomId, {
      type: msg.type,
      tool: msg.tool,
      color: msg.color,
      size: msg.size,
      path: msg.path,
      startX: msg.startX,
      startY: msg.startY,
      userId: ws.id
    });
    
    // Persist state after each completed stroke
    drawingStateManager.saveState(ws.roomId);
  }
  
  broadcast(ws.roomId, msg, ws.id);
}

// Handle batched draw-move events from high-latency clients
function handleDrawBatch(ws, msg) {
  if (!ws.roomId) return;
  if (!Array.isArray(msg.moves) || msg.moves.length === 0) return;
  
  // Broadcast each move in the batch
  for (const move of msg.moves) {
    if (typeof move.x !== 'number' || typeof move.y !== 'number') continue;
    
    broadcast(ws.roomId, {
      type: 'draw-move',
      userId: ws.id,
      username: ws.username,
      tool: move.tool,
      color: move.color,
      size: move.size,
      x: move.x,
      y: move.y
    }, ws.id);
  }
}

function handleCursorMove(ws, msg) {
  if (!ws.roomId) return;
  broadcast(ws.roomId, {
    type: 'cursor-move',
    userId: ws.id,
    username: ws.username,
    x: msg.x,
    y: msg.y
  }, ws.id);
}

function handleCanvasClear(ws) {
  if (!ws.roomId) return;
  drawingStateManager.clearState(ws.roomId);
  broadcast(ws.roomId, { type: 'canvas-clear', userId: ws.id });
  
  // Persist cleared state
  drawingStateManager.saveState(ws.roomId);
}

// Ctrl+Z - undo most recent action by anyone
function handleUndoGlobal(ws) {
  if (!ws.roomId) return;
  
  const affectedAction = drawingStateManager.undoGlobal(ws.roomId);
  if (affectedAction) {
    const state = drawingStateManager.getState(ws.roomId);
    broadcast(ws.roomId, { 
      type: 'canvas-rebuild', 
      state,
      undoType: 'global',
      affectedActionId: affectedAction.id,
      triggeredBy: ws.username
    });
    console.log(`[${ws.username}] global undo -> action #${affectedAction.id}`);
    
    // Persist after undo
    drawingStateManager.saveState(ws.roomId);
  }
}

// Alt+Z - undo only current user's last action
function handleUndoMy(ws) {
  if (!ws.roomId) return;
  
  const affectedAction = drawingStateManager.undoForUser(ws.roomId, ws.id);
  if (affectedAction) {
    const state = drawingStateManager.getState(ws.roomId);
    broadcast(ws.roomId, { 
      type: 'canvas-rebuild', 
      state,
      undoType: 'my',
      affectedActionId: affectedAction.id,
      triggeredBy: ws.username
    });
    console.log(`[${ws.username}] my undo -> action #${affectedAction.id}`);
    
    // Persist after undo
    drawingStateManager.saveState(ws.roomId);
  }
}

// Ctrl+Shift+Z - redo most recently undone action
function handleRedoGlobal(ws) {
  if (!ws.roomId) return;
  
  const affectedAction = drawingStateManager.redoGlobal(ws.roomId);
  if (affectedAction) {
    const state = drawingStateManager.getState(ws.roomId);
    broadcast(ws.roomId, { 
      type: 'canvas-rebuild', 
      state,
      undoType: 'redo',
      affectedActionId: affectedAction.id,
      triggeredBy: ws.username
    });
    console.log(`[${ws.username}] global redo -> action #${affectedAction.id}`);
    
    // Persist after redo
    drawingStateManager.saveState(ws.roomId);
  }
}

function handleDisconnect(ws) {
  if (!ws.roomId) return;
  
  const room = roomManager.getRoom(ws.roomId);
  if (!room) return;
  
  roomManager.removeUser(ws.roomId, ws.id);
  const users = roomManager.getUsers(ws.roomId);
  
  broadcast(ws.roomId, {
    type: 'user-left',
    userId: ws.id,
    username: ws.username,
    userCount: users.length
  });
  
  console.log(`${ws.username} left ${ws.roomId}`);
  
  if (users.length === 0) {
    // Save state before removing from memory (for persistence across restarts)
    drawingStateManager.saveState(ws.roomId);
    
    // Remove from memory but keep persisted file
    roomManager.deleteRoom(ws.roomId);
    drawingStateManager.deleteState(ws.roomId);
    console.log(`Room ${ws.roomId} removed from memory (persisted to disk)`);
  }
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws, msg) {
  send(ws, { type: 'error', message: msg });
}

function broadcast(roomId, data, excludeId = null) {
  const users = roomManager.getUsers(roomId);
  const json = JSON.stringify(data);
  for (const user of users) {
    if (user.id !== excludeId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(json);
    }
  }
}

function sanitize(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/[<>"'&]/g, '').trim().slice(0, maxLen);
}

function isValidDrawData(data) {
  if (!data || !data.type) return false;
  
  if (['draw-start', 'draw-move'].includes(data.type)) {
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return false;
    if (Math.abs(data.x) > 10000 || Math.abs(data.y) > 10000) return false;
  }
  
  if (data.type === 'draw-end') {
    if (!Array.isArray(data.path) || data.path.length > 10000) return false;
  }
  
  return true;
}

// Kill dead connections every 30s
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`🎨 Canvas server at http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  
  // Save all active room states before shutdown
  const rooms = roomManager.getAllRoomIds ? roomManager.getAllRoomIds() : [];
  rooms.forEach(roomId => {
    drawingStateManager.saveState(roomId);
  });
  
  wss.close(() => server.close(() => process.exit(0)));
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully (SIGINT)...');
  
  // Save all active room states before shutdown
  const rooms = roomManager.getAllRoomIds ? roomManager.getAllRoomIds() : [];
  rooms.forEach(roomId => {
    drawingStateManager.saveState(roomId);
  });
  
  wss.close(() => server.close(() => process.exit(0)));
});
