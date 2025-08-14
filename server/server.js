const express = require('express');
const { createServer } = require('http');
const { createServer: createHttpsServer } = require('https');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const requestIp = require('request-ip');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
let server;

// Configuración del servidor HTTP/HTTPS
if (isProduction) {
  try {
    const certPath = '/etc/letsencrypt/live/pizarra.serviflashapp.com';
    const httpsOptions = {
      key: fs.readFileSync(`${certPath}/privkey.pem`),
      cert: fs.readFileSync(`${certPath}/fullchain.pem`),
      minVersion: 'TLSv1.2',
      ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
      honorCipherOrder: true
    };
    server = createHttpsServer(httpsOptions, app);
    console.log('Modo: Producción (HTTPS)');
  } catch (error) {
    console.error('Error al cargar certificados HTTPS, usando HTTP:', error.message);
    server = createServer(app);
    console.log('Modo: Desarrollo (HTTP) - Fallback por error en certificados');
  }
} else {
  server = createServer(app);
  console.log('Modo: Desarrollo (HTTP)');
}

// Configuración de CORS
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = isProduction 
      ? [
          'https://pizarra.serviflashapp.com',
          'https://www.pizarra.serviflashapp.com'
        ]
      : ['*'];

    if (!origin || allowedOrigins.includes('*') || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      console.warn(`Origen no permitido: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Configuración de Socket.IO
const io = new Server(server, {
  cors: corsOptions,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 25000,
  pingInterval: 10000,
  cookie: false,
  proxy: isProduction,
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: { level: 3 },
  },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  connectTimeout: 20000,
  maxHttpBufferSize: 1e8,
  httpCompression: true
});

// Manejo de errores global
io.on('error', (error) => {
  console.error('Error en Socket.IO:', error);
});

// Middleware para parsear JSON y datos de formulario
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, '../public'), { 
  index: false,
  maxAge: isProduction ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Manejo de cierre del proceso
process.on('SIGINT', () => {
  console.log('Recibida señal SIGINT. Cerrando servidor...');
  io.close(() => {
    console.log('Socket.IO cerrado');
    process.exit(0);
  });
});

// Ruta de estado unificada
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    socket: io.engine.clientsCount > 0 ? 'active' : 'inactive',
    clients: io.engine.clientsCount,
    activeSessions: Object.keys(activeSessions).length,
    isProduction: isProduction
  });
});

// Ruta principal - redirigir a /pizarra
app.get('/', (req, res) => {
  res.redirect(301, '/pizarra');
});

// Ruta de la pizarra
app.get('/pizarra', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } catch (error) {
    console.error('Error al servir index.html:', error);
    res.status(500).send('Error al cargar la aplicación');
  }
});

// Manejo de rutas no encontradas (404)
app.use((req, res, next) => {
  // Si es una ruta de API, devolver 404 en formato JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ 
      status: 'error',
      message: 'Ruta no encontrada',
      path: req.path 
    });
  }
  
  // Para rutas no-API, redirigir a /pizarra si no es ya esa ruta
  if (req.path !== '/pizarra' && req.path !== '/pizarra/') {
    return res.redirect(301, '/pizarra');
  }
  
  // Si ya está en /pizarra pero no se manejó antes, es un 404
  res.status(404).send('Página no encontrada');
});

// Almacenamiento de sesiones y dibujos
const activeSessions = new Map(); // ip -> { socketId, lastActivity, isCreator }
let drawings = [];
let creatorId = null;

// Limpieza periódica de sesiones inactivas (30 minutos)
const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutos

function cleanupInactiveSessions() {
  const now = Date.now();
  let creatorDisconnected = false;
  let sessionsRemoved = 0;

  for (const [sessionId, data] of activeSessions.entries()) {
    if (now - data.lastActivity > INACTIVITY_TIMEOUT) {
      const socket = io.sockets.sockets.get(data.socketId);
      if (socket) {
        socket.disconnect(true);
      }
      if (data.isCreator) {
        creatorDisconnected = true;
      }
      activeSessions.delete(sessionId);
      sessionsRemoved++;
      console.log(`Sesión inactiva eliminada: ${sessionId.substring(0, 30)}...`);
    }
  }
  
  if (sessionsRemoved > 0) {
    console.log(`Total de sesiones inactivas eliminadas: ${sessionsRemoved}`);
  }

  // Si el creador se desconectó, asignar nuevo creador
  if (creatorDisconnected || !creatorId) {
    assignNewCreator();
  }
}

// Ejecutar limpieza periódicamente
setInterval(cleanupInactiveSessions, CLEANUP_INTERVAL);

function assignNewCreator() {
  const activeSession = Array.from(activeSessions.values())[0];
  if (activeSession) {
    creatorId = activeSession.socketId;
    const socket = io.sockets.sockets.get(creatorId);
    if (socket) {
      socket.emit('set_creator');
      console.log(`Nuevo creador asignado: ${creatorId}`);
    }
  } else {
    creatorId = null;
    console.log('No hay usuarios conectados, la pizarra se ha reiniciado');
  }
}

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
  // No salir del proceso, mantener el servidor en ejecución
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no manejada:', reason);
});

// Función para actualizar la última actividad de una sesión
function updateSessionActivity(sessionId, socketId, isCreator = false) {
  // Solo mantener un socket activo por sesión
  const existingSession = activeSessions.get(sessionId);
  
  activeSessions.set(sessionId, {
    socketId,
    lastActivity: Date.now(),
    isCreator: isCreator || (existingSession?.isCreator || false)
  });
  
  console.log(`Sesión actualizada: ${sessionId.substring(0, 30)}... (${activeSessions.size} sesiones activas)`);
}

// Manejo de conexiones de Socket.IO
io.on('connection', (socket) => {
  try {
    // Obtener la IP real del cliente, considerando proxies
    const clientIp = (socket.handshake.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || 
      socket.handshake.address.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    // Obtener el user agent del cliente
    const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
    
    // Crear un ID de sesión único combinando IP y user agent
    const sessionId = `${clientIp}-${userAgent}`;
    
    // Verificar si el ID de sesión está definido
    if (!sessionId) {
      console.error('No se pudo generar un ID de sesión, cerrando conexión');
      socket.disconnect();
      return;
    }

    // Validar la IP
    if (!clientIp || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
      console.warn('Intento de conexión con IP inválida:', clientIp);
      socket.emit('error', { message: 'Invalid client IP' });
      socket.disconnect(true);
      return;
    }

    // Manejar reconexión de usuario existente
    const existingSession = activeSessions.get(sessionId);
    const isReconnection = !!existingSession;
    const wasCreator = existingSession?.isCreator;

    if (isReconnection) {
      console.log(`Reconexión detectada para IP ${clientIp}, actualizando sesión...`);
      
      // Si el socket anterior sigue activo, cerrarlo
      if (existingSession.socketId && existingSession.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingSession.socketId);
        if (oldSocket) {
          oldSocket.emit('session_replaced', {
            message: 'Nueva sesión detectada desde la misma IP'
          });
          oldSocket.disconnect(true);
        }
      }
    }

    // Registrar/actualizar sesión
    const isFirstUser = activeSessions.size === 0;
    updateSessionActivity(sessionId, socket.id, wasCreator || isFirstUser);

    // Asignar creador si es el primer usuario o si el creador anterior se desconectó
    if (isFirstUser || !creatorId) {
      creatorId = socket.id;
      activeSessions.get(sessionId).isCreator = true;
      socket.emit('set_creator');
      console.log(`Nuevo creador asignado: ${socket.id}`);
    }

    // Enviar dibujos existentes al nuevo cliente
    socket.emit('init_drawings', {
      drawings,
      isCreator: socket.id === creatorId,
      timestamp: Date.now()
    });

    // Manejar eventos de dibujo
    socket.on('draw', (data, callback) => {
      try {
        // Validar datos de dibujo
        if (!data || typeof data !== 'object') {
          console.warn(`Datos de dibujo inválidos de ${socket.id}`);
          if (typeof callback === 'function') {
            callback({ status: 'error', message: 'Datos de dibujo inválidos' });
          }
          return;
        }

        // Actualizar actividad
        updateSessionActivity(clientIp, socket.id, socket.id === creatorId);

        // Asignar ID y timestamp al dibujo
        const drawingData = {
          ...data,
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          timestamp: Date.now(),
          userId: socket.id
        };

        // Almacenar y transmitir el dibujo
        drawings.push(drawingData);
        socket.broadcast.emit('draw', drawingData);

        // Confirmar recepción
        if (typeof callback === 'function') {
          callback({ status: 'ok', id: drawingData.id });
        }
      } catch (error) {
        console.error('Error al procesar dibujo:', error);
        if (typeof callback === 'function') {
          callback({ status: 'error', message: error.message });
        }
      }
    });

    // Manejar limpieza de la pizarra
    socket.on('clear_canvas', (data, callback) => {
      try {
        // Cualquier usuario puede borrar el lienzo
        console.log(`Usuario ${socket.id} solicitó borrar el lienzo`);

        // Limpiar todos los dibujos
        drawings = [];
        const clearedBy = socket.id;
        const clearTimestamp = Date.now();

        // Notificar a todos los clientes
        io.emit('clear_canvas', { 
          clearedBy, 
          timestamp: clearTimestamp,
          message: 'El lienzo ha sido borrado'
        });

        if (typeof callback === 'function') {
          callback({ status: 'ok', timestamp: clearTimestamp });
        }
      } catch (error) {
        console.error('Error al limpiar la pizarra:', error);
        if (typeof callback === 'function') {
          callback({ status: 'error', message: error.message });
        }
      }
    });

    // Manejar ping para mantener la sesión activa
    socket.on('ping', (data, callback) => {
      try {
        updateSessionActivity(clientIp, socket.id, socket.id === creatorId);
        if (typeof callback === 'function') {
          callback({
            status: 'pong',
            timestamp: Date.now(),
            isCreator: socket.id === creatorId
          });
        }
      } catch (error) {
        console.error('Error en ping:', error);
      }
    });

    // Manejar desconexión
    socket.on('disconnect', (reason) => {
      const disconnectTime = new Date().toISOString();
      console.log(`Cliente desconectado: ${socket.id} (${reason}) [${disconnectTime}]`);

      // Actualizar estado de la sesión
      const session = activeSessions.get(clientIp);
      if (session && session.socketId === socket.id) {
        const wasCreator = session.isCreator;
        activeSessions.delete(clientIp);

        // Si el creador se desconecta, asignar nuevo creador
        if (wasCreator) {
          console.log('El creador se ha desconectado, buscando reemplazo...');
          assignNewCreator();
        }
      }
    });

    // Manejar errores de socket
    socket.on('error', (error) => {
      console.error(`Error en el socket ${socket.id}:`, error);
      socket.emit('error', { 
        message: 'Error en la conexión',
        code: error.code || 'UNKNOWN_ERROR'
      });
    });
  } catch (error) {
    console.error("Error en el manejador de conexión:", error);
    socket.disconnect(true);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Servidor corriendo en ${isProduction ? "https" : "http"}://0.0.0.0:${PORT}`
  );
  console.log(`Entorno: ${isProduction ? "Producción" : "Desarrollo"}`);
});
