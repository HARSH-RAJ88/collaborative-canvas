# Collaborative Canvas

A real-time collaborative drawing application that allows multiple users to draw together on a shared canvas.

## Features

- 🎨 **Real-time Drawing** - See others draw in real-time
- 👥 **Multi-user Rooms** - Create or join rooms with shareable links
- 🖌️ **Multiple Tools** - Brush, eraser, line, rectangle, and circle tools
- 🎨 **Color Picker** - Full color picker with preset colors
- 📏 **Adjustable Brush Size** - Fine to thick strokes
- 👆 **Cursor Tracking** - See where others are pointing
- 💾 **Download** - Save your canvas as PNG
- 📱 **Responsive** - Works on desktop and mobile

## Quick Start

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
cd collaborative-canvas
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

### Development Mode

For auto-restart on file changes:
```bash
npm run dev
```

## Usage

### Creating a Room

1. Open the application in your browser
2. Enter your username
3. Leave the Room ID empty to create a new room
4. Click "Join Canvas"

### Joining a Room

1. Get the room link or ID from another user
2. Enter your username
3. Enter the Room ID (or use the shared link)
4. Click "Join Canvas"

### Drawing Tools

| Tool | Description |
|------|-------------|
| ✏️ Brush | Freehand drawing |
| 🧹 Eraser | Erase drawings |
| 📏 Line | Draw straight lines |
| ⬜ Rectangle | Draw rectangles |
| ⭕ Circle | Draw circles |

### Keyboard Shortcuts

- **Clear Canvas**: Click the 🗑️ button (confirms before clearing)
- **Download**: Click the 💾 button to save as PNG

## API Endpoints

### Health Check
```
GET /health
```
Returns server status, room count, and connection count.

### Room Info
```
GET /api/rooms/:roomId
```
Returns information about a specific room.

## WebSocket Events

### Client → Server

| Event | Description |
|-------|-------------|
| `join-room` | Join or create a room |
| `draw-start` | Started drawing |
| `draw-move` | Drawing in progress |
| `draw-end` | Finished drawing |
| `cursor-move` | Cursor position update |
| `canvas-clear` | Clear the canvas |

### Server → Client

| Event | Description |
|-------|-------------|
| `room-joined` | Successfully joined room |
| `user-joined` | Another user joined |
| `user-left` | A user left |
| `draw-start` | Another user started drawing |
| `draw-move` | Another user is drawing |
| `draw-end` | Another user finished drawing |
| `cursor-move` | Another user's cursor moved |
| `canvas-clear` | Canvas was cleared |
| `state-sync` | Initial canvas state for new users |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |

## Project Structure

```
collaborative-canvas/
├── client/
│   ├── index.html      # Canvas UI
│   ├── style.css       # Layout & tools styling
│   ├── canvas.js       # Canvas drawing logic
│   ├── websocket.js    # WebSocket client logic
│   └── main.js         # App bootstrap & wiring
│
├── server/
│   ├── server.js       # Express + WebSocket server
│   ├── rooms.js        # Room creation & tracking
│   └── drawing-state.js # Canvas state per room
│
├── package.json        # Server dependencies
├── README.md           # Setup & usage (this file)
└── ARCHITECTURE.md     # System design
```

## Testing with Multiple Users

### Local Testing (Same Machine)

1. Start the server:
   ```bash
   npm start
   ```

2. Open **multiple browser windows/tabs** to `http://localhost:3000`

3. In each window:
   - Enter a different username (e.g., "User1", "User2")
   - Use the same Room ID to join the same canvas
   - Or leave Room ID empty in the first window, then copy the generated room link

4. Test features:
   - Draw in one window → see it appear in others
   - Test cursor tracking (see other users' cursors)
   - Test undo/redo:
     - `Ctrl+Z` = Global undo (undoes anyone's last action)
     - `Alt+Z` = My undo (undoes only your last action)
     - `Ctrl+Shift+Z` or `Ctrl+Y` = Global redo

### Network Testing (Different Devices)

1. Find your local IP:
   ```bash
   # Windows
   ipconfig
   # Mac/Linux
   ifconfig
   ```

2. Start the server and access from other devices:
   ```
   http://<your-local-ip>:3000
   ```

3. Ensure all devices are on the same network

### Automated Testing Simulation

```bash
# Open 3 browser tabs quickly (PowerShell)
Start-Process "http://localhost:3000"
Start-Process "http://localhost:3000"
Start-Process "http://localhost:3000"
```

## Known Limitations & Bugs

### Limitations

| Limitation | Description |
|------------|-------------|
| **No Persistence** | Canvas state is lost when server restarts |
| **Single Server** | Cannot scale horizontally without Redis |
| **Memory Bound** | Large drawings (1000+ strokes) consume server memory |
| **No Authentication** | Anyone with room ID can join |
| **Action History Limit** | Only last 1000 actions stored per room |

### Known Bugs

| Bug | Workaround |
|-----|------------|
| Rapid undo/redo may cause flicker | Wait for canvas rebuild between operations |
| Touch drawing on some mobile browsers may have offset | Use desktop browser for best experience |
| Reconnection may lose in-progress stroke | Complete your stroke before network issues |

### Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ Fully supported |
| Firefox 88+ | ✅ Fully supported |
| Safari 14+ | ✅ Supported |
| Edge 90+ | ✅ Fully supported |
| Mobile Chrome | ⚠️ Works, touch may have issues |
| Mobile Safari | ⚠️ Works, touch may have issues |

## Time Spent

| Phase | Time |
|-------|------|
| Initial Setup & Architecture | 2 hours |
| Canvas Drawing Implementation | 3 hours |
| WebSocket Real-time Sync | 2 hours |
| Undo/Redo System (Global + User-scoped) | 2 hours |
| Performance Optimizations | 1.5 hours |
| UI/UX & Styling | 1 hour |
| Testing & Bug Fixes | 1 hour |
| Documentation | 0.5 hours |
| **Total** | **~13 hours** |

## Troubleshooting

### Connection Issues

1. Ensure the server is running (`npm start`)
2. Check if port 3000 is available
3. Check browser console for WebSocket errors

### Drawing Not Syncing

1. Verify WebSocket connection (green status indicator)
2. Check if you're in the same room as other users
3. Refresh the page to reconnect

### Undo Not Working

1. Ensure you have actions to undo
2. Check keyboard shortcut: `Ctrl+Z` (global) or `Alt+Z` (your actions only)
3. Clear actions cannot be undone

## License

MIT License - Feel free to use this project for learning and building!
