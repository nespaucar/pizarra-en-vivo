const express = require("express");
const { createServer } = require("http");
const { createServer: createHttpsServer } = require("https");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const requestIp = require("request-ip");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
let server;

// Configuración del servidor HTTP/HTTPS
if (isProduction) {
  try {
    const certPath = "/etc/letsencrypt/live/pizarra.serviflashapp.com";
    const httpsOptions = {
      key: fs.readFileSync(`${certPath}/privkey.pem`),
      cert: fs.readFileSync(`${certPath}/fullchain.pem`),
      minVersion: "TLSv1.2",
      ciphers: "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256",
      honorCipherOrder: true,
    };
    server = createHttpsServer(httpsOptions, app);
    //console.log('Modo: Producción (HTTPS)');
  } catch (error) {
    //console.error('Error al cargar certificados HTTPS, usando HTTP:', error.message);
    server = createServer(app);
    //console.log('Modo: Desarrollo (HTTP) - Fallback por error en certificados');
  }
} else {
  server = createServer(app);
  //console.log('Modo: Desarrollo (HTTP)');
}

// Configuración de CORS
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = isProduction
      ? [
          "https://pizarra.serviflashapp.com",
          "https://www.pizarra.serviflashapp.com",
        ]
      : ["*"];

    if (
      !origin ||
      allowedOrigins.includes("*") ||
      allowedOrigins.some((o) => origin.startsWith(o))
    ) {
      callback(null, true);
    } else {
      //console.warn(`Origen no permitido: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Configuración de Socket.IO
const io = new Server(server, {
  cors: corsOptions,
  path: "/socket.io",
  transports: ["websocket", "polling"],
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
  httpCompression: true,
});

// Manejo de errores global
io.on("error", (error) => {
  //console.error('Error en Socket.IO:', error);
});

// Middleware para parsear JSON y datos de formulario
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(
  express.static(path.join(__dirname, "../public"), {
    index: false,
    maxAge: isProduction ? "1d" : "0",
    etag: true,
    lastModified: true,
  })
);

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Manejo de cierre del proceso
process.on("SIGINT", () => {
  //console.log('Recibida señal SIGINT. Cerrando servidor...');
  io.close(() => {
    //console.log('Socket.IO cerrado');
    process.exit(0);
  });
});

// Ruta de estado unificada
app.get("/status", (req, res) => {
  res.json({
    status: "ok",
    serverTime: new Date().toISOString(),
    socket: io.engine.clientsCount > 0 ? "active" : "inactive",
    clients: io.engine.clientsCount,
    activeSessions: Object.keys(activeSessions).length,
    isProduction: isProduction,
  });
});

// Ruta principal - redirigir a /pizarra
app.get("/", (req, res) => {
  res.redirect(301, "/pizarra");
});

// Ruta de la pizarra
app.get("/pizarra", (req, res) => {
  try {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  } catch (error) {
    //console.error('Error al servir index.html:', error);
    res.status(500).send("Error al cargar la aplicación");
  }
});

// Manejo de rutas no encontradas (404)
app.use((req, res, next) => {
  // Si es una ruta de API, devolver 404 en formato JSON
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      status: "error",
      message: "Ruta no encontrada",
      path: req.path,
    });
  }

  // Para rutas no-API, redirigir a /pizarra si no es ya esa ruta
  if (req.path !== "/pizarra" && req.path !== "/pizarra/") {
    return res.redirect(301, "/pizarra");
  }

  // Si ya está en /pizarra pero no se manejó antes, es un 404
  res.status(404).send("Página no encontrada");
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
      //console.log(`Sesión inactiva eliminada: ${sessionId.substring(0, 30)}...`);
    }
  }

  if (sessionsRemoved > 0) {
    //console.log(`Total de sesiones inactivas eliminadas: ${sessionsRemoved}`);
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
      socket.emit("set_creator");
      //console.log(`Nuevo creador asignado: ${creatorId}`);
    }
  } else {
    creatorId = null;
    //console.log('No hay usuarios conectados, la pizarra se ha reiniciado');
  }
}

// Manejo de errores no capturados
process.on("uncaughtException", (error) => {
  //console.error('Error no capturado:', error);
  // No salir del proceso, mantener el servidor en ejecución
});

process.on("unhandledRejection", (reason, promise) => {
  //console.error('Promesa rechazada no manejada:', reason);
});

// Función para actualizar la última actividad de una sesión
function updateSessionActivity(sessionId, socketId, isCreator = false) {
  const session = activeSessions.get(sessionId);

  if (session) {
    // Actualizar la última actividad
    session.lastActivity = Date.now();

    // Si es el creador, marcar como tal
    if (isCreator) {
      session.isCreator = true;
      if (!creatorId) {
        creatorId = socketId;
      }
    }

    //console.log(`Sesión actualizada: ${sessionId.substring(0, 30)}... (${activeSessions.size} sesiones activas)`);
  }
}

// Manejo de conexiones de Socket.IO
io.on("connection", (socket) => {
  try {
    // Obtener la IP real del cliente, considerando proxies
    const clientIp =
      (socket.handshake.headers["x-forwarded-for"] || "")
        .split(",")
        .shift()
        .trim() ||
      socket.handshake.address ||
      socket.conn.remoteAddress;

    // Manejar unión a sesión
    socket.on("join_session", (data) => {
      const { sessionId } = data;

      // Si no hay sessionId, crear una nueva sesión
      if (!sessionId) {
        const newSessionId = `sess_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        activeSessions.set(newSessionId, {
          socketIds: new Set([socket.id]),
          lastActivity: Date.now(),
          isCreator: !creatorId,
          drawings: [],
        });

        if (!creatorId) {
          creatorId = socket.id;
        }

        return socket.emit("session_status", {
          sessionId: newSessionId,
          sessionExists: false,
          hasDrawings: false,
        });
      }

      // Buscar sesión existente
      const existingSession = activeSessions.get(sessionId);

      if (existingSession) {
        // Agregar este socket a la sesión existente
        existingSession.socketIds.add(socket.id);
        existingSession.lastActivity = Date.now();

        // Si es el creador, notificar
        if (existingSession.isCreator && !creatorId) {
          creatorId = socket.id;
          socket.emit("set_creator");
        }

        // Notificar al cliente
        socket.emit("session_status", {
          sessionId,
          sessionExists: true,
          hasDrawings:
            existingSession.drawings && existingSession.drawings.length > 0,
        });

        // Enviar dibujos existentes si los hay
        if (existingSession.drawings && existingSession.drawings.length > 0) {
          socket.emit("redraw", existingSession.drawings);
        }
      } else {
        // Si la sesión no existe, crear una nueva
        const newSessionId = `sess_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        activeSessions.set(newSessionId, {
          socketIds: new Set([socket.id]),
          lastActivity: Date.now(),
          isCreator: !creatorId,
          drawings: [],
        });

        if (!creatorId) {
          creatorId = socket.id;
          socket.emit("set_creator");
        }

        socket.emit("session_status", {
          sessionId: newSessionId,
          sessionExists: false,
          hasDrawings: false,
        });
      }
    });

    // Obtener el user agent del cliente
    const userAgent = socket.handshake.headers["user-agent"] || "unknown";

    // Crear un ID de sesión único combinando IP y user agent
    const sessionId = `${clientIp}-${userAgent}`;

    // Verificar si el ID de sesión está definido
    if (!sessionId) {
      //console.error('No se pudo generar un ID de sesión, cerrando conexión');
      socket.disconnect();
      return;
    }

    // Validar la IP
    if (!clientIp || clientIp === "::1" || clientIp === "::ffff:127.0.0.1") {
      //console.warn('Intento de conexión con IP inválida:', clientIp);
      socket.emit("error", { message: "Invalid client IP" });
      socket.disconnect(true);
      return;
    }

    // Manejar reconexión de usuario existente
    const existingSession = activeSessions.get(sessionId);
    const isReconnection = !!existingSession;
    const wasCreator = existingSession?.isCreator;

    if (isReconnection) {
      //console.log(`Reconexión detectada para IP ${clientIp}, actualizando sesión...`);

      // Si el socket anterior sigue activo, cerrarlo
      if (existingSession.socketId && existingSession.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingSession.socketId);
        if (oldSocket) {
          oldSocket.emit("session_replaced", {
            message: "Nueva sesión detectada desde la misma IP",
          });
          oldSocket.disconnect(true);
        }
      }
    }

    // Registrar/actualizar sesión
    const isFirstUser = activeSessions.size === 0;

    // Asegurarse de que la sesión existe
    if (!activeSessions.has(sessionId)) {
      activeSessions.set(sessionId, {
        socketIds: new Set([socket.id]),
        lastActivity: Date.now(),
        isCreator: isFirstUser,
        drawings: [],
      });
    } else {
      // Agregar este socket a la sesión existente
      const session = activeSessions.get(sessionId);
      if (!session.socketIds) {
        session.socketIds = new Set();
      }
      session.socketIds.add(socket.id);
      session.lastActivity = Date.now();
    }

    // Actualizar actividad
    updateSessionActivity(sessionId, socket.id, wasCreator || isFirstUser);

    // Asignar creador si es el primer usuario o si el creador anterior se desconectó
    if (isFirstUser || !creatorId) {
      creatorId = socket.id;
      const session = activeSessions.get(sessionId);
      if (session) {
        session.isCreator = true;
      }
      socket.emit("set_creator");
      //console.log(`Nuevo creador asignado: ${socket.id}`);
    }

    // Enviar dibujos existentes al nuevo cliente
    const sessionData = activeSessions.get(sessionId);
    let sessionDrawings =
      sessionData && Array.isArray(sessionData.drawings)
        ? [...sessionData.drawings]
        : [];

    // Buscar el último evento de limpieza
    const lastClearIndex = sessionDrawings
      .map((d, i) => (d.type === "clear" ? i : -1))
      .filter((i) => i !== -1)
      .pop();

    // Si hay un evento de limpieza, solo mantener los dibujos posteriores
    if (lastClearIndex !== undefined) {
      sessionDrawings = sessionDrawings.slice(lastClearIndex);
      //console.log(`Filtrados dibujos después del último clear. Enviando ${sessionDrawings.length} dibujos.`);
    }

    //console.log(`Enviando ${sessionDrawings.length} dibujos al nuevo cliente ${socket.id} en la sesión ${sessionId}`);

    socket.emit("init_drawings", {
      sessionId: sessionId,
      drawings: sessionDrawings,
      isCreator: socket.id === creatorId,
      timestamp: Date.now(),
      totalDrawings: sessionDrawings.length,
      lastClear: lastClearIndex !== undefined,
    });

    // Manejar solicitud de redibujado
    socket.on("request_redraw", () => {
      try {
        // Buscar la sesión del cliente
        for (const [sessionId, sessionData] of activeSessions.entries()) {
          if (sessionData.socketIds && sessionData.socketIds.has(socket.id)) {
            // Enviar todos los dibujos de la sesión al cliente
            socket.emit("init_drawings", {
              sessionId: sessionId,
              drawings: Array.isArray(sessionData.drawings)
                ? sessionData.drawings
                : [],
              timestamp: Date.now(),
              totalDrawings: sessionData.drawings
                ? sessionData.drawings.length
                : 0,
            });
            //console.log(`Enviados ${sessionData.drawings ? sessionData.drawings.length : 0} dibujos al cliente ${socket.id}`);
            break;
          }
        }
      } catch (error) {
        //console.error('Error al redibujar:', error);
      }
    });

    // Manejar limpieza del canvas
    socket.on("clear_canvas", (data, callback) => {
      try {
        //console.log(`Usuario ${socket.id} solicitó borrar el lienzo`);

        // Buscar la sesión del cliente
        for (const [sessionId, sessionData] of activeSessions.entries()) {
          if (sessionData.socketIds && sessionData.socketIds.has(socket.id)) {
            // Crear un evento de limpieza
            const clearEvent = {
              type: "clear",
              id: `clear_${Date.now()}`,
              timestamp: Date.now(),
              userId: socket.id,
              sessionId: sessionId,
            };

            // Limpiar los dibujos de la sesión
            sessionData.drawings = [clearEvent];

            // Enviar a todos los clientes conectados
            io.emit("draw", clearEvent);

            //console.log(`Canvas limpiado por ${socket.id} en la sesión ${sessionId}`);

            // Confirmar la limpieza
            if (typeof callback === "function") {
              callback({ status: "ok", message: "Canvas limpiado" });
            }
            break;
          }
        }
      } catch (error) {
        //console.error('Error al limpiar el canvas:', error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Error al limpiar el canvas" });
        }
      }
    });

    // Manejar eventos de dibujo
    socket.on("draw", (data, callback) => {
      try {
        /*console.log('Evento de dibujo recibido:', {
          type: data.type,
          fromSocket: socket.id,
          data: data
        });*/

        // Validar datos de dibujo
        if (!data || typeof data !== "object" || !data.type) {
          //console.warn(`Datos de dibujo inválidos de ${socket.id}:`, data);
          if (typeof callback === "function") {
            callback({ status: "error", message: "Datos de dibujo inválidos" });
          }
          return;
        }

        // Encontrar la sesión actual
        let currentSession = null;
        let currentSessionId = null;

        //console.log('Buscando sesión para el socket:', socket.id);
        /*console.log('Sesiones activas:', Array.from(activeSessions.entries()).map(([id, s]) => ({
          id: id.substring(0, 10) + '...',
          socketCount: s.socketIds?.size || 0,
          drawingsCount: s.drawings?.length || 0
        })));*/

        // Buscar en todas las sesiones
        for (const [sessionId, sessionData] of activeSessions.entries()) {
          if (sessionData.socketIds && sessionData.socketIds.has(socket.id)) {
            currentSession = sessionData;
            currentSessionId = sessionId;
            break;
          }
        }

        if (!currentSession) {
          //console.warn(`No se encontró la sesión para el socket ${socket.id}`);
          if (typeof callback === "function") {
            callback({ status: "error", message: "Sesión no encontrada" });
          }
          return;
        }

        // Inicializar array de dibujos si no existe
        if (!Array.isArray(currentSession.drawings)) {
          currentSession.drawings = [];
        }

        // Actualizar actividad de la sesión
        updateSessionActivity(
          currentSessionId,
          socket.id,
          socket.id === creatorId
        );

        // Crear el objeto de dibujo con los datos necesarios
        const drawingData = {
          type: data.type,
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          timestamp: Date.now(),
          userId: socket.id,
          sessionId: currentSessionId,
          // Propiedades específicas del tipo de dibujo
          x1: Number(data.x1) || 0,
          y1: Number(data.y1) || 0,
          x2: Number(data.x2) || 0,
          y2: Number(data.y2) || 0,
          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          size: Number(data.size) || 5,
          color: String(data.color || "#000000"),
          text: data.text || "",
          shape: data.shape || "",
          fill: Boolean(data.fill),
          // Datos de depuración
          _debug: {
            serverTime: new Date().toISOString(),
            sessionDrawingsCount: currentSession.drawings.length,
          },
        };

        //console.log(`Nuevo dibujo recibido (${drawingData.type}) de ${socket.id} en sesión ${currentSessionId}`);

        // Agregar a la sesión
        currentSession.drawings.push(drawingData);

        /*console.log(`Dibujo agregado a la sesión ${currentSessionId}. Total de dibujos: ${currentSession.drawings.length}`, {
          drawingId: drawingData.id,
          type: drawingData.type,
          timestamp: drawingData.timestamp
        });*/

        // Limitar el historial a 1000 dibujos
        if (currentSession.drawings.length > 1000) {
          currentSession.drawings = currentSession.drawings.slice(-1000);
        }

        // Enviar a TODOS los clientes conectados
        io.emit("draw", drawingData);
        //console.log(`Dibujo transmitido a todos los clientes (${io.engine.clientsCount} clientes conectados)`);

        // Confirmar recepción
        if (typeof callback === "function") {
          callback({
            status: "ok",
            drawingId: drawingData.id,
            totalDrawings: currentSession.drawings.length,
            message: "Dibujo recibido correctamente",
          });
        }
      } catch (error) {
        //console.error('Error al procesar el dibujo:', error, data);
        if (typeof callback === "function") {
          callback({
            status: "error",
            message: "Error al procesar el dibujo",
            error: error.message,
          });
        }
      }
    });

    // Manejar desconexión
    socket.on("disconnect", (reason) => {
      const disconnectTime = new Date().toISOString();
      //console.log(`Cliente desconectado: ${socket.id} (${reason}) [${disconnectTime}]`);

      // Buscar y eliminar el socket de la sesión
      for (const [sessionId, sessionData] of activeSessions.entries()) {
        if (sessionData.socketIds && sessionData.socketIds.has(socket.id)) {
          // Eliminar este socket de la sesión
          sessionData.socketIds.delete(socket.id);

          //console.log(`Socket ${socket.id} eliminado de la sesión ${sessionId.substring(0, 10)}...`);

          // Si era el creador, asignar nuevo creador
          if (socket.id === creatorId) {
            //console.log('Creador desconectado, buscando nuevo creador...');
            sessionData.isCreator = false;
            creatorId = null;
            assignNewCreator();
          }

          // Si no quedan más sockets en esta sesión, eliminarla después de un tiempo
          if (sessionData.socketIds.size === 0) {
            //console.log(`No hay más clientes en la sesión ${sessionId.substring(0, 10)}..., programando eliminación...`);

            // Programar eliminación después de un tiempo (por si el cliente se reconecta)
            setTimeout(() => {
              const session = activeSessions.get(sessionId);
              if (session && session.socketIds.size === 0) {
                activeSessions.delete(sessionId);
                //console.log(`Sesión ${sessionId.substring(0, 10)}... eliminada por inactividad`);
              }
            }, 30000); // 30 segundos
          }

          break;
        }
      }
    });

    // Manejar errores de socket
    socket.on("error", (error) => {
      //console.error(`Error en el socket ${socket.id}:`, error);
      socket.emit("error", {
        message: "Error en la conexión",
        code: error.code || "UNKNOWN_ERROR",
      });
    });
  } catch (error) {
    //console.error("Error en el manejador de conexión:", error);
    socket.disconnect(true);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  /*console.log(
    `Servidor corriendo en ${isProduction ? "https" : "http"}://0.0.0.0:${PORT}`
  );*/
  //console.log(`Entorno: ${isProduction ? "Producción" : "Desarrollo"}`);
});
