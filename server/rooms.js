const { v4: uuidv4 } = require('uuid');

class Room {
  constructor(id = null) {
    this.id = id || this.generateId();
    this.users = new Map();
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  generateId() {
    // Readable chars only (no 0/O, 1/I/L confusion)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  addUser(userId, username, ws) {
    if (!userId || !ws) return;
    this.users.set(userId, { id: userId, username: username || 'Anonymous', ws, joinedAt: new Date() });
    this.lastActivity = new Date();
  }

  removeUser(userId) {
    this.users.delete(userId);
    this.lastActivity = new Date();
  }

  getUsers() {
    return Array.from(this.users.values());
  }

  isEmpty() {
    return this.users.size === 0;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    
    // Clean up empty rooms every minute
    this.cleanup = setInterval(() => this.cleanupRooms(), 60000);
  }

  createRoom(roomId = null) {
    if (roomId && this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }
    
    const room = new Room(roomId);
    this.rooms.set(room.id, room);
    console.log(`Room created: ${room.id}`);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  roomExists(roomId) {
    return this.rooms.has(roomId);
  }

  deleteRoom(roomId) {
    if (this.rooms.has(roomId)) {
      this.rooms.delete(roomId);
      return true;
    }
    return false;
  }

  addUser(roomId, userId, username, ws) {
    const room = this.rooms.get(roomId);
    if (room) room.addUser(userId, username, ws);
  }

  removeUser(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (room) room.removeUser(userId);
  }

  getUsers(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.getUsers() : [];
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getAllRoomIds() {
    return Array.from(this.rooms.keys());
  }

  cleanupRooms() {
    const now = Date.now();
    const maxIdle = 30 * 60 * 1000; // 30 min
    
    for (const [id, room] of this.rooms) {
      if (room.isEmpty() && (now - room.lastActivity) > maxIdle) {
        this.deleteRoom(id);
        console.log(`Cleaned up room ${id}`);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanup);
    this.rooms.clear();
  }
}

module.exports = { Room, RoomManager };
