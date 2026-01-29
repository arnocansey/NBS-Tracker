// backend/src/websockets.js
const { Server } = require("socket.io");

let io;

function init(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: "*", // In production, restrict this to your frontend's URL
            methods: ["GET", "POST"]
        }
    });

    console.log('🔌 WebSocket server initialized');

    io.on('connection', (socket) => {
        console.log(`⚡ User connected: ${socket.id}`);
        socket.on('disconnect', () => {
            console.log(`🔥 User disconnected: ${socket.id}`);
        });
    });

    return io;
}

function getIO() {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
}

module.exports = { init, getIO };
