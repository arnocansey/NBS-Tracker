const { Server } = require('socket.io');
const config = require('./config/app.config');

let io;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
    },
  });

  console.log('WebSocket server initialized');

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  return io;
}

function emit(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
}

module.exports = { init, getIO, emit };
