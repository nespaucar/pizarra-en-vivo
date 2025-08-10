const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const requestIp = require('request-ip');

const app = express();
const server = http.createServer(app);

// Configuración de CORS
app.use(cors());

// Configuración de Socket.IO
const io = socketIo(server, {
  cors: {
    origin: [
      'http://serviflashapp.com',
      'https://serviflashapp.com',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://' + process.env.HOST || '0.0.0.0'
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  // Configuración para producción
  path: "/socket.io/",
  // Usar polling primero para mayor compatibilidad
  transports: ["polling", "websocket"],
  allowEIO3: true,
  // Configuración de timeouts
  pingTimeout: 60000,
  pingInterval: 25000,
  // Configuración de sesión
  cookie: false,
  // Configuración para proxy inverso
  proxy: false, // Desactivar proxy para depuración
  // Configuración de WebSocket
  perMessageDeflate: false, // Desactivar compresión para depuración
  // Habilitar actualizaciones de transporte
  allowUpgrades: true,
  // Configuración de reconexión
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  // Deshabilitar timeouts para depuración
  connectTimeout: 30000
});

// Configuración de CORS para rutas normales
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Middleware
app.use(express.json());
app.use('/pizarra', express.static(path.join(__dirname, '../public')));
app.use(requestIp.mw());

// Redirigir / a /pizarra
app.get("/", (req, res) => {
  res.redirect('/pizarra');
});

// Ruta de la pizarra
app.get("/pizarra", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Ruta para verificar que el servidor está funcionando
app.get('/status', (req, res) => {
  res.json({ status: 'ok', socket: 'active' });
});

// Store active sessions and drawings
const activeSessions = new Map(); // ip -> socket.id
const drawings = [];
let creatorId = null;

io.on('connection', (socket) => {
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
