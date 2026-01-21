# Architecture Documentation

## System Overview

The Collaborative Canvas is a real-time collaborative drawing application built with a client-server architecture using WebSockets for bidirectional communication.

```
┌─────────────────────────────────────────────────────────────────┐
│                         ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │ Client 1 │     │ Client 2 │     │ Client N │               │
│   │  Browser │     │  Browser │     │  Browser │               │
│   └────┬─────┘     └────┬─────┘     └────┬─────┘               │
│        │                │                │                      │
│        │    WebSocket   │    WebSocket   │                      │
│        └────────────────┼────────────────┘                      │
│                         │                                        │
│                         ▼                                        │
│              ┌─────────────────────┐                            │
│              │   WebSocket Server  │                            │
│              │   (Node.js + ws)    │                            │
│              └──────────┬──────────┘                            │
│                         │                                        │
│         ┌───────────────┼───────────────┐                       │
│         ▼               ▼               ▼                       │
│   ┌──────────┐   ┌──────────┐   ┌──────────────┐               │
│   │  Room    │   │  Room    │   │   Drawing    │               │
│   │ Manager  │   │  State   │   │   State Mgr  │               │
│   └──────────┘   └──────────┘   └──────────────┘               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Design

### Client-Side Components

#### 1. Canvas Manager (`canvas.js`)

Handles all drawing operations on the HTML5 Canvas.

**Responsibilities:**
- Mouse and touch event handling
- Drawing tools implementation (brush, eraser, shapes)
- Local canvas rendering
- Remote drawing application
- Canvas state restoration

**Key Classes:**
```javascript
class CanvasManager {
  // Drawing state
  isDrawing: boolean
  currentTool: string
  currentColor: string
  brushSize: number
  
  // Methods
  handleStart(e)    // Start drawing
  handleMove(e)     // Continue drawing
  handleEnd(e)      // End drawing
  applyState(state) // Restore canvas state
}
```

#### 2. WebSocket Client (`websocket.js`)

Manages real-time communication with the server.

**Responsibilities:**
- WebSocket connection management
- Automatic reconnection
- Message serialization/deserialization
- Event dispatching

**Key Classes:**
```javascript
class WebSocketClient {
  // Connection
  connect(username, roomId)
  disconnect()
  attemptReconnect()
  
  // Drawing events
  sendDrawStart(data)
  sendDrawMove(data)
  sendDrawEnd(data)
  
  // Cursor tracking
  sendCursorMove(x, y)
}
```

#### 3. Main App (`main.js`)

Bootstraps the application and wires components together.

**Responsibilities:**
- DOM event handling
- Component initialization
- UI state management
- Remote cursor rendering

### Server-Side Components

#### 1. Server (`server.js`)

Main entry point handling HTTP and WebSocket connections.

**Responsibilities:**
- Express server setup
- WebSocket server setup
- Message routing
- Connection lifecycle management

**Key Endpoints:**
- `GET /` - Serve client application
- `GET /health` - Health check
- `GET /api/rooms/:id` - Room information
- `WS /` - WebSocket connections

#### 2. Room Manager (`rooms.js`)

Manages room creation and user tracking.

**Responsibilities:**
- Room creation/deletion
- User join/leave handling
- Room cleanup (inactive rooms)

**Data Structure:**
```javascript
Room {
  id: string           // Unique room identifier
  users: Map<id, User> // Connected users
  createdAt: Date
  lastActivity: Date
}

User {
  id: string
  username: string
  ws: WebSocket
  joinedAt: Date
}
```

#### 3. Drawing State Manager (`drawing-state.js`)

Persists canvas state for each room.

**Responsibilities:**
- Store drawing actions
- Provide state for new users
- State compression
- Memory management

**Data Structure:**
```javascript
DrawingState {
  roomId: string
  actions: Action[]    // Drawing history
  maxActions: number   // Memory limit
}

Action {
  type: string         // draw-end, clear
  tool: string         // brush, eraser, etc.
  color: string
  size: number
  path: Point[]
  timestamp: Date
}
```

## Data Flow

### Drawing Flow

```
User draws on canvas
        │
        ▼
┌─────────────────┐
│ CanvasManager   │ ─── Renders locally
│ handleMove()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WebSocketClient │
│ sendDrawMove()  │
└────────┬────────┘
         │
         ▼ (WebSocket message)
┌─────────────────┐
│ Server          │
│ handleDrawEvent │
└────────┬────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│ DrawingState    │  │ Broadcast to    │
│ (if draw-end)   │  │ other clients   │
└─────────────────┘  └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Other Clients   │
                     │ remoteDrawMove  │
                     └─────────────────┘
```

### Join Room Flow

```
User clicks "Join"
        │
        ▼
┌─────────────────┐
│ WebSocketClient │
│ connect()       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Server          │
│ handleJoinRoom  │
└────────┬────────┘
         │
         ├─────────────────┬─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────┐  ┌─────────────────┐
│ RoomManager     │ │ Send state  │  │ Broadcast       │
│ addUser()       │ │ to new user │  │ user-joined     │
└─────────────────┘ └──────┬──────┘  └─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ CanvasManager   │
                  │ applyState()    │
                  └─────────────────┘
```

## Message Protocol

### WebSocket Messages

All messages are JSON with a `type` field:

```javascript
// Client → Server
{
  type: 'join-room',
  roomId: string | null,
  username: string
}

{
  type: 'draw-start' | 'draw-move' | 'draw-end',
  tool: string,
  color: string,
  size: number,
  x: number,
  y: number,
  path?: Point[],      // Only for draw-end
  startX?: number,     // For shapes
  startY?: number
}

{
  type: 'cursor-move',
  x: number,
  y: number
}

{
  type: 'canvas-clear'
}

// Server → Client
{
  type: 'room-joined',
  roomId: string,
  userId: string,
  users: User[]
}

{
  type: 'user-joined' | 'user-left',
  userId: string,
  username: string,
  userCount: number
}

{
  type: 'state-sync',
  state: DrawingState
}
```

## Scalability Considerations

### Current Limitations

1. **Single Server** - State is stored in memory
2. **No Persistence** - State lost on server restart
3. **Memory Growth** - Large drawings consume memory

### Future Improvements

1. **Redis Integration**
   - Store room and drawing state in Redis
   - Enable horizontal scaling

2. **Canvas Compression**
   - Compress drawing actions
   - Use canvas snapshots for large states

3. **Sharding**
   - Partition rooms across servers
   - Use sticky sessions

4. **CDN for Static Assets**
   - Serve client files from CDN
   - Reduce server load

## Security Considerations

### Implemented

- Room IDs are short but unpredictable
- No authentication required (by design)
- WebSocket origin not restricted (development)

### Recommended for Production

1. **Rate Limiting**
   - Limit messages per second per client
   - Prevent DoS attacks

2. **Input Validation**
   - Validate all incoming messages
   - Sanitize usernames

3. **HTTPS/WSS**
   - Use TLS in production
   - Secure WebSocket connections

4. **Room Limits**
   - Max users per room
   - Max rooms per server

## Undo/Redo Strategy

### Design Decision: Soft Delete with `undone` Flag

Instead of removing actions from history, we mark them with an `undone: true` flag. This enables:
- **Reversible operations** - Redo is possible
- **Audit trail** - Full history preserved
- **Simpler conflict resolution** - No array mutation during concurrent operations

### Action Structure

```javascript
Action {
  id: number,           // Sequential, unique per room
  userId: string,       // Who created this action
  type: 'stroke',       // Action type
  payload: {...},       // Drawing data
  timestamp: Date,
  undone: boolean       // false = active, true = undone
}
```

### Three Undo/Redo Operations

```
┌─────────────────────────────────────────────────────────────┐
│                     UNDO/REDO SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Ctrl+Z (Global Undo)                                       │
│  ─────────────────────                                      │
│  Undoes the MOST RECENT action by ANY user                  │
│  • Finds last action where undone=false                     │
│  • Sets undone=true                                         │
│  • Broadcasts canvas-rebuild to all clients                 │
│                                                             │
│  Alt+Z (My Undo)                                            │
│  ────────────────                                           │
│  Undoes only YOUR most recent action                        │
│  • Finds last action where undone=false AND userId=yours    │
│  • Sets undone=true                                         │
│  • Broadcasts canvas-rebuild to all clients                 │
│                                                             │
│  Ctrl+Shift+Z (Global Redo)                                 │
│  ─────────────────────────                                  │
│  Redoes the MOST RECENTLY undone action                     │
│  • Finds last action where undone=true                      │
│  • Sets undone=false                                        │
│  • Broadcasts canvas-rebuild to all clients                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Undo/Redo Flow

```
User presses Ctrl+Z
        │
        ▼
┌─────────────────┐
│ WebSocketClient │
│ sendUndoGlobal()│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Server          │
│ handleUndoGlobal│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ DrawingState    │
│ undoGlobal()    │──► Mark action.undone = true
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Broadcast       │
│ canvas-rebuild  │──► Full state to ALL clients
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ All Clients     │
│ rebuild(state)  │──► Clear canvas, replay active actions
└─────────────────┘
```

## Conflict Resolution

### Strategy: Server-Authoritative State

The server is the **single source of truth**. This eliminates conflicts by design:

```
┌─────────────────────────────────────────────────────────────┐
│                  CONFLICT RESOLUTION                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Problem: User A and User B draw simultaneously             │
│  ─────────────────────────────────────────────              │
│                                                             │
│  Solution: Both actions are accepted (no conflict)          │
│  • Server assigns sequential IDs to all actions             │
│  • Order determined by server receive time                  │
│  • Both strokes appear on all canvases                      │
│                                                             │
│  Problem: User A undoes while User B is drawing             │
│  ──────────────────────────────────────────────             │
│                                                             │
│  Solution: Server processes in order                        │
│  • Undo marks the last completed action as undone           │
│  • B's in-progress stroke continues unaffected              │
│  • When B finishes, their action is added normally          │
│                                                             │
│  Problem: Two users press Ctrl+Z at the same time           │
│  ─────────────────────────────────────────────              │
│                                                             │
│  Solution: Server serializes requests                       │
│  • First undo processed → marks action N as undone          │
│  • Second undo processed → marks action N-1 as undone       │
│  • Both get canvas-rebuild with consistent state            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Why No Conflicts Occur

1. **Additive Operations** - Drawing strokes are always appended, never modified
2. **Atomic Undo** - Server processes one undo at a time
3. **Full State Sync** - After any undo/redo, all clients rebuild from server state
4. **No Local State** - Clients don't maintain separate undo stacks

### State Consistency Guarantee

```javascript
// Server always sends complete state
broadcast(roomId, {
  type: 'canvas-rebuild',
  state: {
    actions: [...],  // ALL actions with undone flags
    actionCount: n
  }
});

// Client rebuilds deterministically
rebuild(state) {
  clearCanvas();
  const active = state.actions.filter(a => !a.undone);
  active.forEach(action => applyAction(action));
}
```

## Performance Optimizations

### Why These Specific Optimizations?

| Optimization | Problem Solved | Implementation |
|--------------|----------------|----------------|
| **Cursor Throttling (50ms)** | 60+ cursor events/sec overwhelms network | `requestAnimationFrame` + timestamp check |
| **Adaptive Draw Batching** | High-frequency draw events on slow networks | Batch based on RTT: <50ms→8ms, <100ms→16ms, ≥150ms→batch |
| **Snapshot Caching** | Rebuilding 1000 actions is slow | Cache `ImageData` every 50 actions, replay from nearest |
| **Path Optimization** | Raw paths have redundant points | Reduce points + quadratic curve smoothing |
| **Full State Rebuild** | Incremental sync causes drift | Always rebuild from server state on undo/redo |

### Client-Side Performance

```javascript
// Adaptive throttling based on network latency
getAdaptiveThrottle() {
  const latency = this.getLatency();
  if (latency < 50) return 8;    // Fast network: 8ms throttle
  if (latency < 100) return 16;  // Medium: 16ms
  if (latency < 200) return 32;  // Slow: 32ms
  return 50;                      // Very slow: 50ms + batching
}

// Snapshot caching for efficient rebuilds
rebuild(state) {
  // Find nearest cached snapshot
  const snapshot = findNearestSnapshot(actionCount);
  if (snapshot) {
    ctx.putImageData(snapshot, 0, 0);
    replayFrom(snapshot.index);  // Only replay newer actions
  }
}
```

### Server-Side Performance

- **Heartbeat (30s)** - Detect dead connections, free resources
- **Room Cleanup (30min)** - Remove inactive rooms automatically
- **Action Limit (1000)** - Prevent unbounded memory growth
- **Batch Processing** - Handle `draw-batch` messages for slow clients

### Network Optimization

```
┌─────────────────────────────────────────────────────────────┐
│                LATENCY-ADAPTIVE BATCHING                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Latency < 50ms (Fast)                                      │
│  • Send individual draw-move events                         │
│  • 8ms minimum between sends                                │
│  • Best responsiveness                                      │
│                                                             │
│  Latency 50-150ms (Medium)                                  │
│  • Send individual events with longer throttle              │
│  • 16-32ms between sends                                    │
│  • Balance responsiveness/bandwidth                         │
│                                                             │
│  Latency ≥ 150ms (Slow)                                     │
│  • Batch multiple points into single message                │
│  • Reduce total messages sent                               │
│  • Prioritize reliability over smoothness                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Testing Strategy

### Unit Tests
- Canvas drawing functions
- WebSocket message handling
- Room management logic

### Integration Tests
- Client-server communication
- Multi-user scenarios
- Reconnection handling

### Load Tests
- Concurrent users
- Message throughput
- Memory usage

## Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| HOST | Bind address | 0.0.0.0 |
| NODE_ENV | Environment | development |
