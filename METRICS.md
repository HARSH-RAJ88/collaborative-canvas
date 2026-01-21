# Performance Metrics Overlay

## Overview

The Performance Metrics Overlay provides real-time visibility into rendering performance and network health. It displays FPS and WebSocket latency in a non-intrusive overlay in the top-right corner of the canvas.

## Features

### 1. FPS Counter
- **What it measures**: Frames rendered per second
- **How it works**: Counts frames using `requestAnimationFrame`
- **Update frequency**: Once per second
- **Display**: Integer value
- **Color coding**:
  - 🟢 Green (≥50 FPS): Excellent performance
  - 🟡 Yellow (30-49 FPS): Acceptable performance
  - 🔴 Red (<30 FPS): Poor performance

### 2. Network Latency (WebSocket RTT)
- **What it measures**: Round-trip time (RTT) for WebSocket ping/pong
- **How it works**: Client sends ping → server responds with pong → client calculates RTT
- **Update frequency**: Every ping cycle (every 3 seconds by default)
- **Rolling average**: Last 5 samples to reduce jitter
- **Display**: Milliseconds
- **Color coding**:
  - 🟢 Green (<100 ms): Fast network
  - 🟡 Yellow (100-200 ms): Moderate network
  - 🔴 Red (>200 ms): Slow network

## UI Design

### Layout
- **Position**: Fixed top-right corner
- **Background**: Semi-transparent dark with blur effect
- **Border**: Subtle blue accent
- **Font**: Monospace (technical look)
- **Opacity**: Fades on hover (non-intrusive)

### Visual Example
```
┌─────────────────┐
│ FPS  60         │
│ Latency 42 ms   │
└─────────────────┘
```

## Implementation Details

### Architecture

```
main.js (App class)
  ├── setupMetrics()
  │   ├── Show/hide overlay based on SHOW_METRICS flag
  │   ├── Wire latency callbacks from WebSocket
  │   └── Start FPS counter loop
  │
  ├── startFpsCounter()
  │   ├── requestAnimationFrame loop
  │   ├── Count frames every 1000ms
  │   └── Update FPS display with color coding
  │
  └── updateMetricsLatency(latency)
      ├── Update latency value
      └── Apply color class based on RTT
```

### Code Structure

**main.js - FPS Counter**
```javascript
startFpsCounter() {
  const updateFps = () => {
    this.frameCount++;
    
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.fpsValue.textContent = this.fps;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      // Apply color coding based on FPS
    }
    
    requestAnimationFrame(updateFps);
  };
  
  requestAnimationFrame(updateFps);
}
```

**websocket.js - Latency Measurement** (already implemented)
```javascript
// Ping every 3 seconds
startLatencyMeasurement() {
  this.pingInterval = setInterval(() => this.measureLatency(), 3000);
}

// Calculate RTT
updateLatency(rtt) {
  this.latencyHistory.push(rtt);
  const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
  this.latency = Math.round(sum / this.latencyHistory.length);
  
  if (this.onLatencyUpdate) {
    this.onLatencyUpdate(this.latency);
  }
}
```

**index.html - Overlay Element**
```html
<div id="metrics-overlay" class="metrics-overlay hidden">
  <div class="metrics-content">
    <div class="metric-item">
      <span class="metric-label">FPS</span>
      <span id="fps-value" class="metric-value">--</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Latency</span>
      <span id="latency-value" class="metric-value">--</span>
      <span class="metric-unit">ms</span>
    </div>
  </div>
</div>
```

**style.css - Styling**
```css
.metrics-overlay {
  position: fixed;
  top: 12px;
  right: 12px;
  background: rgba(26, 26, 46, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(74, 144, 217, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  z-index: 999;
  pointer-events: none;  /* Non-blocking */
  transition: opacity 0.2s ease;
}

.metric-value.latency-good { color: #4ade80; }  /* Green */
.metric-value.latency-fair { color: #fbbf24; }  /* Yellow */
.metric-value.latency-poor { color: #f87171; }  /* Red */
```

## Configuration

### Enable/Disable Metrics

**To show metrics by default:**
```javascript
// In main.js, line 26
const SHOW_METRICS = true;
```

**To hide metrics by default:**
```javascript
// In main.js, line 26
const SHOW_METRICS = false;
```

### Adjust FPS Update Frequency

To change FPS update interval (currently 1 second), modify in `startFpsCounter()`:
```javascript
if (elapsed >= 1000) {  // Change 1000 to desired milliseconds
  this.fps = Math.round((this.frameCount * 1000) / elapsed);
  // ...
}
```

### Adjust Latency Measurement Frequency

To change latency ping frequency (currently 3 seconds), modify in `websocket.js`:
```javascript
this.pingInterval = setInterval(() => this.measureLatency(), 3000);  // Change 3000
```

### Adjust Latency Thresholds

To change color thresholds, modify in `updateMetricsLatency()`:
```javascript
if (latency < 100) {      // Change 100 for green threshold
  this.latencyValue.classList.add('latency-good');
} else if (latency < 200) { // Change 200 for yellow threshold
  this.latencyValue.classList.add('latency-fair');
}
```

## Performance Impact

### Impact Analysis

| Metric | Impact | Notes |
|--------|--------|-------|
| **CPU** | Negligible | RAF-based loop has minimal overhead |
| **Memory** | Negligible | Stores only 2 values + 5-element array |
| **Network** | ~100 bytes/3s | Ping/pong messages |
| **Rendering** | Zero | No canvas modification |
| **Drawing Logic** | Zero | Completely isolated |

### Verification

- ✅ No change to `CanvasManager` drawing logic
- ✅ No change to `WebSocketClient` draw event handlers
- ✅ No change to `server.js` draw message routing
- ✅ Latency measurement doesn't interfere with draw batching
- ✅ FPS counter uses separate RAF loop (doesn't throttle drawing)

## Use Cases

### Debugging Performance Issues
1. Low FPS? → Check CPU load, rendering complexity
2. High latency? → Check network conditions, server load
3. Combined issues? → Test on different network/device

### Testing Network Conditions
1. Use browser DevTools throttling
2. Monitor metrics overlay for real-time feedback
3. Observe how drawing quality adapts to latency

### Monitoring Production
1. Real-time visibility into user experience
2. Identify problematic network conditions
3. Debug performance complaints

## Technical Guarantees

✅ **Does NOT affect drawing correctness**
- Metrics are purely diagnostic
- No modification to canvas state
- No modification to drawing algorithms

✅ **Does NOT affect undo/redo logic**
- Metrics are read-only
- No state changes
- No server-side storage

✅ **Does NOT affect real-time synchronization**
- Latency measurement doesn't block drawing
- Ping/pong is independent of draw events
- Metrics callback doesn't modify game state

✅ **Zero dependencies**
- Pure JavaScript
- Uses browser APIs (RAF, performance.now())
- No libraries required

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| FPS Counter (RAF) | ✅ | ✅ | ✅ | ✅ |
| Latency Measurement | ✅ | ✅ | ✅ | ✅ |
| Metrics Overlay | ✅ | ✅ | ✅ | ✅ |
| Backdrop Filter | ✅ | ✅ | ✅ | ✅ |
| Fixed Positioning | ✅ | ✅ | ✅ | ✅ |
| Mobile Browsers | ✅ | ✅ | ✅ | ✅ |

## Troubleshooting

### Metrics Not Showing
1. Check if `SHOW_METRICS = true` in main.js
2. Check browser console for errors
3. Verify metrics-overlay element exists in index.html

### FPS Shows "--"
1. Wait 1 second for first update
2. Check if RAF is running (DevTools Performance tab)
3. Verify frameCount is incrementing

### Latency Shows "--"
1. Wait for first ping response (~3 seconds)
2. Check WebSocket connection (should be "connected")
3. Verify server is responding to ping messages

### Metrics Overlay Too Big/Small
1. Adjust font-size in `.metrics-overlay` CSS
2. Adjust padding for spacing
3. Use browser zoom for overall scaling

## Future Enhancements

Potential features for future versions:
- [ ] Toggle metrics with keyboard shortcut (e.g., Ctrl+M)
- [ ] History graph of FPS/latency over time
- [ ] Export metrics as CSV for analysis
- [ ] Per-user metrics comparison
- [ ] Network packet loss indicator
- [ ] Canvas memory usage display
- [ ] Server-side metrics endpoint

## Code Locations

| File | Purpose | Lines |
|------|---------|-------|
| `main.js` | FPS counter, overlay wiring | 1-30, 260-330 |
| `websocket.js` | Latency measurement | 100-145 |
| `index.html` | Metrics overlay HTML | 88-99 |
| `style.css` | Metrics overlay CSS | 396-455 |
