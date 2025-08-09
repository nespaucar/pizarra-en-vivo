const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const requestIp = require("request-ip");
const path = require("path");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Configuración de CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Configuración para producción
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, "../public")));
app.use(requestIp.mw());

// Ruta raíz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Store active sessions and drawings
const activeSessions = new Map(); // ip -> socket.id
const drawings = [];
let creatorId = null;

io.on("connection", (socket) => {
  const clientIp =
    socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;

  console.log(`New connection from ${clientIp}`);

  // Handle new user connection
  if (activeSessions.has(clientIp)) {
    // Disconnect previous session with same IP
    const oldSocketId = activeSessions.get(clientIp);
    io.to(oldSocketId).emit("session_replaced");
    io.sockets.sockets.get(oldSocketId)?.disconnect(true);
  }

  activeSessions.set(clientIp, socket.id);

  // Set first user as creator
  if (!creatorId) {
    creatorId = socket.id;
    socket.emit("set_creator");
  }

  // Send existing drawings to new user
  socket.emit("init_drawings", drawings);

  // Handle drawing events
  socket.on("draw", (data) => {
    drawings.push(data);
    socket.broadcast.emit("draw", data);
  });

  // Handle clear event (only from creator)
  socket.on("clear_canvas", () => {
    if (socket.id === creatorId) {
      drawings.length = 0;
      io.emit("clear_canvas");
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    if (activeSessions.get(clientIp) === socket.id) {
      activeSessions.delete(clientIp);
    }

    // If creator disconnects, assign new creator
    if (socket.id === creatorId) {
      const newCreator = activeSessions.values().next().value;
      if (newCreator) {
        creatorId = newCreator;
        io.to(newCreator).emit("set_creator");
      } else {
        creatorId = null;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
