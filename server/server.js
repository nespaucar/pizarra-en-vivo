const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const socketIo = require("socket.io");
const path = require("path");
const cors = require("cors");
const requestIp = require("request-ip");

const app = express();

// Configuración del entorno
const isProduction = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3030;
let server;

// Configuración del servidor HTTP/HTTPS
if (
  isProduction &&
  fs.existsSync("/etc/letsencrypt/live/pizarra.serviflashapp.com/privkey.pem")
) {
  const httpsOptions = {
    key: fs.readFileSync(
      "/etc/letsencrypt/live/pizarra.serviflashapp.com/privkey.pem"
    ),
    cert: fs.readFileSync(
      "/etc/letsencrypt/live/pizarra.serviflashapp.com/fullchain.pem"
    ),
  };
  server = https.createServer(httpsOptions, app);
  console.log("Modo: Producción (HTTPS)");
} else {
  // En desarrollo o si no hay certificados, usa HTTP
  server = http.createServer(app);
  console.log("Modo: Desarrollo (HTTP)");
}

// Configuración de CORS
const corsOptions = {
  origin: function (origin, callback) {
    // En desarrollo, permitir todos los orígenes
    if (!isProduction) {
      return callback(null, true);
    }

    // En producción, solo permitir orígenes específicos
    const allowedOrigins = [
      "https://pizarra.serviflashapp.com",
      "https://www.pizarra.serviflashapp.com",
    ];

    // Permitir solicitudes sin origen (como curl o aplicaciones móviles)
    if (!origin) return callback(null, true);

    // Verificar si el origen está permitido
    if (
      allowedOrigins.some((allowedOrigin) => origin.startsWith(allowedOrigin))
    ) {
      return callback(null, true);
    }

    console.warn(`Intento de conexión desde origen no permitido: ${origin}`);
    return callback(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Configuración de Socket.IO
const io = socketIo(server, {
  cors: corsOptions,
  path: "/socket.io/",
  transports: ["websocket", "polling"], // Preferir WebSocket sobre polling
  allowEIO3: true,

  // Configuración de timeouts
  pingTimeout: 25000, // Tiempo de espera de ping (25 segundos)
  pingInterval: 10000, // Intervalo de ping (10 segundos)

  // Configuración de sesión
  cookie: false,

  // Configuración para proxy inverso
  proxy: isProduction, // Habilitar solo en producción

  // Configuración de compresión
  perMessageDeflate: {
    threshold: 1024, // Umbral de compresión en bytes
    zlibDeflateOptions: {
      level: 3, // Nivel de compresión (0-9)
    },
  },

  // Configuración de reconexión
  reconnection: true,
  reconnectionAttempts: 10, // Número máximo de intentos de reconexión
  reconnectionDelay: 1000, // Tiempo inicial entre reconexiones (1s)
  reconnectionDelayMax: 5000, // Tiempo máximo entre reconexiones (5s)

  // Timeout de conexión
  connectTimeout: 20000, // 20 segundos

  // Mejoras de rendimiento
  maxHttpBufferSize: 1e8, // Tamaño máximo del buffer (100MB)
  httpCompression: true, // Compresión HTTP

  // Seguridad
  allowRequest: (req, callback) => {
    // Aquí puedes añadir lógica adicional de autenticación si es necesario
    callback(null, true);
  },
});

// Configuración de CORS para rutas normales
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  next();
});

// Middleware
app.use(express.json());
app.use(requestIp.mw());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "../public")));

// Redirigir / a /pizarra
app.get("/", (req, res) => {
  // Usar redirección 301 para SEO y caché del navegador
  res.redirect(301, '/pizarra');
});

// Ruta de la pizarra - debe ir después de los archivos estáticos
app.get("/pizarra", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/index.html"));
});

// Capturar 404 para SPA
app.get('*', (req, res) => {
  res.redirect(301, '/pizarra');
});

// Ruta para verificar que el servidor está funcionando
app.get("/status", (req, res) => {
  res.json({ status: "ok", socket: "active" });
});

// Almacenamiento de sesiones y dibujos
const activeSessions = new Map(); // ip -> { socketId, lastActivity }
const drawings = [];
let creatorId = null;

// Limpieza periódica de sesiones inactivas (30 minutos)
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutos
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of activeSessions.entries()) {
    if (now - data.lastActivity > INACTIVITY_TIMEOUT) {
      const socket = io.sockets.sockets.get(data.socketId);
      if (socket) {
        socket.disconnect(true);
      }
      activeSessions.delete(ip);
      console.log(`Sesión inactiva eliminada: ${ip}`);
    }
  }
}, 5 * 60 * 1000); // Verificar cada 5 minutos

// Manejo de errores no capturados
process.on("uncaughtException", (error) => {
  console.error("Error no capturado:", error);
  // No salir del proceso, mantener el servidor en ejecución
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Promesa rechazada no manejada:", reason);
});

// Función para actualizar la última actividad de una sesión
function updateSessionActivity(ip, socketId) {
  activeSessions.set(ip, {
    socketId,
    lastActivity: Date.now(),
  });
}

// Manejo de conexiones Socket.IO
io.on("connection", (socket) => {
  try {
    // Obtener la IP real del cliente, considerando proxies
    const clientIp =
      socket.handshake.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      socket.handshake.address;

    console.log(
      `[${new Date().toISOString()}] Nueva conexión desde ${clientIp} (ID: ${
        socket.id
      })`
    );

    // Validar la IP
    if (!clientIp) {
      console.warn("Intento de conexión sin IP válida");
      socket.disconnect(true);
      return;
    }

    // Manejar reconexión de usuario existente
    const existingSession = activeSessions.get(clientIp);
    if (existingSession) {
      console.log(
        `Conexión existente encontrada para IP ${clientIp}, cerrando sesión anterior...`
      );
      const oldSocket = io.sockets.sockets.get(existingSession.socketId);
      if (oldSocket && oldSocket.id !== socket.id) {
        oldSocket.emit("session_replaced", {
          message: "Nueva sesión detectada desde la misma IP",
        });
        oldSocket.disconnect(true);
      }
    }

    // Registrar nueva sesión
    updateSessionActivity(clientIp, socket.id);

    // Asignar creador si es el primer usuario
    if (!creatorId) {
      creatorId = socket.id;
      socket.emit("set_creator");
      console.log(`Nuevo creador asignado: ${socket.id}`);
    }

    // Enviar dibujos existentes al nuevo usuario
    socket.emit("init_drawings", {
      drawings,
      isCreator: socket.id === creatorId,
    });

    // Manejar eventos de dibujo
    socket.on("draw", (data) => {
      try {
        // Validar datos de dibujo
        if (!data || typeof data !== "object") {
          console.warn(`Datos de dibujo inválidos de ${socket.id}`);
          return;
        }

        // Actualizar actividad
        updateSessionActivity(clientIp, socket.id);

        // Almacenar y transmitir el dibujo
        drawings.push(data);
        socket.broadcast.emit("draw", data);
      } catch (error) {
        console.error("Error al procesar dibujo:", error);
      }
    });

    // Manejar evento de limpieza (solo para el creador)
    socket.on("clear_canvas", () => {
      if (socket.id === creatorId) {
        console.log(`Pizarra limpiada por el creador (${socket.id})`);
        drawings.length = 0;
        io.emit("clear_canvas");
      } else {
        console.warn(
          `Intento no autorizado de limpiar la pizarra desde ${socket.id}`
        );
      }
    });

    // Manejar latencia
    socket.on("ping", (callback) => {
      updateSessionActivity(clientIp, socket.id);
      callback();
    });

    // Manejar desconexión
    socket.on("disconnect", (reason) => {
      console.log(`Cliente desconectado: ${socket.id} (${reason})`);

      const session = activeSessions.get(clientIp);
      if (session && session.socketId === socket.id) {
        activeSessions.delete(clientIp);
      }

      // Si el creador se desconecta, asignar nuevo creador
      if (socket.id === creatorId) {
        console.log("El creador se ha desconectado, buscando reemplazo...");
        const newCreator = Array.from(activeSessions.values())[0];
        if (newCreator) {
          creatorId = newCreator.socketId;
          io.to(creatorId).emit("set_creator");
          console.log(`Nuevo creador asignado: ${creatorId}`);
        } else {
          creatorId = null;
          console.log(
            "No hay más usuarios conectados, la pizarra se ha reiniciado"
          );
        }
      }
    });

    // Manejar errores de socket
    socket.on("error", (error) => {
      console.error(`Error en el socket ${socket.id}:`, error);
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
