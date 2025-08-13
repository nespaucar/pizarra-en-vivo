// Función para inicializar la aplicación
function initApp() {
  // Verificar que Socket.IO esté disponible
  if (typeof io === 'undefined') {
    console.error('Error: Socket.IO no se ha cargado correctamente');
    document.getElementById('status').textContent = 'Error: No se pudo cargar Socket.IO';
    return;
  }

  // Canvas setup
  const canvas = document.getElementById("whiteboard");
  const ctx = canvas.getContext("2d");

  // Tool elements
  const pencilBtn = document.getElementById("pencil");
  const eraserBtn = document.getElementById("eraser");
  const colorPicker = document.getElementById("colorPicker");
  const brushSize = document.getElementById("brushSize");
  const brushSizeValue = document.getElementById("brushSizeValue");
  const shapes = document.getElementById("shapes");
  const clearBtn = document.getElementById("clear");
  const saveBtn = document.getElementById("save");
  const statusEl = document.getElementById("status");

  // Drawing state
  let isDrawing = false;
  let currentTool = "pencil";
  let currentColor = "#000000";
  let currentSize = 5;
  let startX, startY;
  let lastX, lastY;
  let snapshot;
  let isCreator = false;

  // Configuración del socket para la raíz
  const socket = io({
    path: '/socket.io/',
    // Usar el protocolo actual (http o https) basado en la página actual
    secure: window.location.protocol === 'https:',
    // Usar polling primero para la conexión inicial
    transports: ['polling', 'websocket'],
    // Configuración de reconexión
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Timeout de conexión
    timeout: 20000,
    // Solo deshabilitar verificación de certificado en desarrollo
    rejectUnauthorized: process.env.NODE_ENV !== 'production',
    // Forzar el uso de WebSocket después de la conexión inicial
    upgrade: true,
    // Deshabilitar la compresión
    perMessageDeflate: false,
    // Configuración de consulta para depuración
    query: {
      t: Date.now(), // Evitar caché
      debug: 'true'
    }
  });

  // Verificar conexión
  socket.on('connect', () => {
    console.log('Conectado al servidor de sockets con ID:', socket.id);
  });

  socket.on('connect_error', (error) => {
    console.error('Error de conexión:', error);
    console.log('Intentando reconectar...');
  });

  // Depuración
  console.log('Conectando a Socket.IO en:', window.SERVER_URL);
  console.log('Configuración del socket:', {
    secure: window.location.protocol === 'https:',
    hostname: window.location.hostname,
    port: window.location.port
  });

  // Set canvas size
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 60; // Account for toolbar height
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    // Redraw canvas content after resize
    socket.emit("request_redraw");
  });

  resizeCanvas();

  // Tool event listeners
  pencilBtn.addEventListener("click", () => {
    currentTool = "pencil";
    updateToolUI();
  });

  eraserBtn.addEventListener("click", () => {
    currentTool = "eraser";
    updateToolUI();
  });

  colorPicker.addEventListener("input", (e) => {
    currentColor = e.target.value;
  });

  brushSize.addEventListener("input", (e) => {
    currentSize = e.target.value;
    brushSizeValue.textContent = `${currentSize}px`;
  });

  function updateToolUI() {
    // Update active tool button
    document
      .querySelectorAll(".tool")
      .forEach((btn) => btn.classList.remove("active"));
    if (currentTool === "pencil") pencilBtn.classList.add("active");
    if (currentTool === "eraser") eraserBtn.classList.add("active");

    // Update cursor
    canvas.style.cursor = currentTool === "eraser" ? "cell" : "crosshair";
  }

  // Drawing functions
  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    
    const rect = canvas.getBoundingClientRect();
    startX = (e.clientX || e.touches[0].clientX) - rect.left;
    startY = (e.clientY || e.touches[0].clientY) - rect.top;
    lastX = startX;
    lastY = startY;
    
    // Solo comenzar un nuevo camino sin dibujar
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    // Para formas, guardar el estado del canvas
    if (shapes.value !== 'free') {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
    
    if (shapes.value === 'free') {
        // Dibujo libre
        ctx.lineTo(x, y);
        ctx.strokeStyle = currentTool === 'eraser' ? 'white' : currentColor;
        ctx.lineWidth = currentSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Emitir datos de dibujo
        socket.emit('draw', {
            type: 'draw',
            x1: lastX,
            y1: lastY,
            x2: x,
            y2: y,
            color: currentTool === 'eraser' ? 'white' : currentColor,
            size: currentSize
        });
        
        lastX = x;
        lastY = y;
    } else {
        // Para formas, restaurar el snapshot y dibujar la forma
        ctx.putImageData(snapshot, 0, 0);
        drawShape(x, y, true);
    }
  }

  function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
    
    // Solo dibujar la forma final si no es dibujo libre
    if (shapes.value !== 'free' && startX !== undefined && startY !== undefined) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || (e.changedTouches && e.changedTouches[0].clientX) || lastX) - rect.left;
        const y = (e.clientY || (e.changedTouches && e.changedTouches[0].clientY) || lastY) - rect.top;
        
        // Dibujar la forma final
        drawShape(x, y, false);
        
        // Emitir datos de la forma
        socket.emit('draw', {
            type: 'shape',
            shape: shapes.value,
            x1: startX,
            y1: startY,
            x2: x,
            y2: y,
            color: currentTool === 'eraser' ? 'white' : currentColor,
            size: currentSize
        });
    }
  }

  function drawShape(x, y, isPreview) {
    const color = currentTool === "eraser" ? "white" : currentColor;

    switch (shapes.value) {
      case "line":
        drawLine(startX, startY, x, y, color, currentSize);
        break;
      case "rectangle":
        drawRect(
          startX,
          startY,
          x - startX,
          y - startY,
          color,
          currentSize,
          isPreview
        );
        break;
      case "circle":
        const radius = Math.sqrt(
          Math.pow(x - startX, 2) + Math.pow(y - startY, 2)
        );
        drawCircle(startX, startY, radius, color, currentSize, isPreview);
        break;
    }
  }

  function drawLine(x1, y1, x2, y2, color, size) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.stroke();
  }

  function drawRect(x, y, width, height, color, size, isPreview) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.strokeRect(x, y, width, height);

    if (!isPreview) {
      ctx.fillStyle = color + "33"; // Add transparency
      ctx.fillRect(x, y, width, height);
    }
  }

  function drawCircle(x, y, radius, color, size, isPreview) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.stroke();

    if (!isPreview) {
      ctx.fillStyle = color + "33"; // Add transparency
      ctx.fill();
    }
  }

  // Canvas event listeners
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);

  // Touch support
  canvas.addEventListener("touchstart", startDrawing, { passive: false });
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      draw(e);
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", stopDrawing, { passive: false });

  // Clear canvas
  clearBtn.addEventListener("click", () => {
    if (isCreator) {
      if (
        confirm(
          "¿Estás seguro de que quieres borrar todo el contenido de la pizarra?"
        )
      ) {
        socket.emit("clear_canvas");
      }
    } else {
      alert("Solo el creador de la sesión puede borrar la pizarra.");
    }
  });

  // Save canvas as image
  saveBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "pizarra.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  // Socket.io event listeners
  socket.on("connect", () => {
    statusEl.textContent = "Conectado";
    statusEl.style.color = "#2ecc71";
  });

  socket.on("disconnect", () => {
    statusEl.textContent = "Desconectado";
    statusEl.style.color = "#e74c3c";
  });

  socket.on("connect_error", () => {
    statusEl.textContent = "Error de conexión";
    statusEl.style.color = "#e74c3c";
  });

  socket.on("draw", (data) => {
    if (data.type === "draw") {
      drawLine(data.x1, data.y1, data.x2, data.y2, data.color, data.size);
    } else if (data.type === "shape") {
      const tempSize = ctx.lineWidth;
      const tempColor = ctx.strokeStyle;

      ctx.lineWidth = data.size;

      switch (data.shape) {
        case "line":
          drawLine(data.x1, data.y1, data.x2, data.y2, data.color, data.size);
          break;
        case "rectangle":
          drawRect(
            data.x1,
            data.y1,
            data.x2 - data.x1,
            data.y2 - data.y1,
            data.color,
            data.size,
            false
          );
          break;
        case "circle":
          const radius = Math.sqrt(
            Math.pow(data.x2 - data.x1, 2) + Math.pow(data.y2 - data.y1, 2)
          );
          drawCircle(data.x1, data.y1, radius, data.color, data.size, false);
          break;
      }

      ctx.lineWidth = tempSize;
      ctx.strokeStyle = tempColor;
    }
  });

  socket.on("clear_canvas", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  socket.on("init_drawings", (savedDrawings) => {
    // Clear current canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw all saved drawings
    savedDrawings.forEach((drawing) => {
      if (drawing.type === "draw") {
        drawLine(
          drawing.x1,
          drawing.y1,
          drawing.x2,
          drawing.y2,
          drawing.color,
          drawing.size
        );
      } else if (drawing.type === "shape") {
        const tempSize = ctx.lineWidth;
        const tempColor = ctx.strokeStyle;

        ctx.lineWidth = drawing.size;

        switch (drawing.shape) {
          case "line":
            drawLine(
              drawing.x1,
              drawing.y1,
              drawing.x2,
              drawing.y2,
              drawing.color,
              drawing.size
            );
            break;
          case "rectangle":
            drawRect(
              drawing.x1,
              drawing.y1,
              drawing.x2 - drawing.x1,
              drawing.y2 - drawing.y1,
              drawing.color,
              drawing.size,
              false
            );
            break;
          case "circle":
            const radius = Math.sqrt(
              Math.pow(drawing.x2 - drawing.x1, 2) +
                Math.pow(drawing.y2 - drawing.y1, 2)
            );
            drawCircle(
              drawing.x1,
              drawing.y1,
              radius,
              drawing.color,
              drawing.size,
              false
            );
            break;
        }

        ctx.lineWidth = tempSize;
        ctx.strokeStyle = tempColor;
      }
    });
  });

  socket.on("set_creator", () => {
    isCreator = true;
    clearBtn.disabled = false;
    statusEl.textContent = "Conectado (Creador)";
  });

  socket.on("session_replaced", () => {
    alert(
      "Se ha detectado una nueva conexión desde tu dirección IP. Esta sesión ha sido desconectada."
    );
    window.location.reload();
  });

  // Initialize UI
  updateToolUI();
  brushSizeValue.textContent = `${currentSize}px`;
}

// Inicializar la aplicación cuando el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', initApp);
