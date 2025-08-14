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
  const textBtn = document.getElementById("text");
  const shapesSelect = document.getElementById("shapes");
  const colorPicker = document.getElementById("colorPicker");
  const brushSize = document.getElementById("brushSize");
  const brushSizeValue = document.getElementById("brushSizeValue");
  const clearBtn = document.getElementById("clear");
  const saveBtn = document.getElementById("save");
  const statusEl = document.getElementById("status");

  // Drawing state
  let isDrawing = false;
  let currentTool = "pencil";
  let currentShape = "rectangle"; // Forma predeterminada
  let currentColor = "#000000";
  let currentSize = 5;
  let startX, startY;
  let lastX, lastY;
  let snapshot;
  let isCreator = false;
  let textInput = null; // Para el modo texto
  let drawings = []; // Para almacenar todo lo dibujado

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
    // En producción, verificar certificados. En desarrollo, permitir certificados autofirmados
    rejectUnauthorized: window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1',
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

  // Funciones de dibujo de formas
  function drawShape(shape, x1, y1, x2, y2, color, size, fill = false, isPreview = false) {
    // Guardar el estado actual del contexto
    const prevStrokeStyle = ctx.strokeStyle;
    const prevFillStyle = ctx.fillStyle;
    const prevLineWidth = ctx.lineWidth;
    const prevLineCap = ctx.lineCap;
    const prevLineJoin = ctx.lineJoin;
    
    // Configurar el estilo para la forma
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Si es una vista previa, usar un estilo semitransparente
    if (isPreview) {
      ctx.strokeStyle = color.replace(')', ', 0.5)').replace('rgb', 'rgba');
      ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    switch(shape) {
      case 'rectangle':
        if (fill) ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        else ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
      case 'circle':
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        ctx.beginPath();
        ctx.arc(x1, y1, radius, 0, Math.PI * 2);
        if (fill) ctx.fill();
        else ctx.stroke();
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      case 'arrow':
        const headLength = size * 3;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        
        // Línea principal
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        // Punta de la flecha
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLength * Math.cos(angle - Math.PI / 6),
          y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLength * Math.cos(angle + Math.PI / 6),
          y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
        break;
    }
  }

  // Función para manejar el texto
  function addText(x, y) {
    if (textInput) return; // Evitar múltiples inputs de texto
    
    textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.style.position = 'absolute';
    textInput.style.left = `${x}px`;
    textInput.style.top = `${y}px`;
    textInput.style.border = 'none';
    textInput.style.padding = '5px';
    textInput.style.font = `${currentSize * 2}px Arial`;
    textInput.style.color = currentColor;
    textInput.style.background = 'transparent';
    textInput.style.outline = '1px dashed #ccc';
    
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        if (e.key === 'Enter' && textInput.value.trim()) {
          // Dibujar el texto en el canvas
          ctx.font = `${currentSize * 2}px Arial`;
          ctx.fillStyle = currentColor;
          ctx.fillText(textInput.value, x, y + currentSize * 2);
          
          // Enviar el texto a otros clientes
          socket.emit('draw', {
            type: 'text',
            x,
            y,
            text: textInput.value,
            color: currentColor,
            size: currentSize
          });
        }
        
        // Limpiar
        document.body.removeChild(textInput);
        textInput = null;
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    
    document.body.appendChild(textInput);
    textInput.focus();
    document.addEventListener('keydown', handleKeyDown);
  }

  // Tool event listeners
  pencilBtn.addEventListener("click", () => {
    currentTool = "pencil";
    updateToolUI();
  });

  eraserBtn.addEventListener("click", () => {
    currentTool = "eraser";
    updateToolUI();
  });
  
  textBtn.addEventListener("click", () => {
    currentTool = "text";
    updateToolUI();
  });
  
  if (shapesSelect) {
    shapesSelect.addEventListener("change", (e) => {
      currentTool = e.target.value ? "shape" : "pencil";
      if (currentTool === "shape") {
        currentShape = e.target.value;
      }
      updateToolUI();
    });
  }

  colorPicker.addEventListener("input", (e) => {
    currentColor = e.target.value;
  });

  brushSize.addEventListener("input", (e) => {
    currentSize = e.target.value;
    brushSizeValue.textContent = `${currentSize}px`;
  });

  function updateToolUI() {
    // Actualizar la interfaz de usuario según la herramienta seleccionada
    pencilBtn.classList.toggle("active", currentTool === "pencil");
    eraserBtn.classList.toggle("active", currentTool === "eraser");
    textBtn.classList.toggle("active", currentTool === "text");
    
    // Actualizar el selector de formas
    if (currentTool === "shape") {
      shapesSelect.value = currentShape;
    } else {
      shapesSelect.value = "";
    }
    
    // Habilitar/deshabilitar controles según sea necesario
    colorPicker.disabled = currentTool === "eraser";
    brushSize.disabled = false;
    
    // Cambiar el cursor según la herramienta
    switch(currentTool) {
      case 'pencil':
      case 'eraser':
        canvas.style.cursor = 'crosshair';
        break;
      case 'text':
        canvas.style.cursor = 'text';
        break;
      case 'shape':
        canvas.style.cursor = 'crosshair';
        break;
      default:
        canvas.style.cursor = 'default';
    }
  }

  // Drawing functions
  function startDrawing(e) {
    if (currentTool === 'text') {
      addText(e.offsetX, e.offsetY);
      return;
    }
    
    isDrawing = true;
    
    // Obtener las coordenadas correctamente para ratón y pantalla táctil
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    
    [startX, startY] = [x, y];
    [lastX, lastY] = [x, y];
    
    // Guardar el estado actual del canvas para deshacer
    if (currentTool === "pencil" || currentTool === "eraser" || currentTool === "shape") {
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Si es lápiz o borrador, comenzar un nuevo trazo
      if (currentTool === "pencil" || currentTool === "eraser") {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = currentTool === "eraser" ? "#ffffff" : currentColor;
        ctx.lineWidth = currentTool === "eraser" ? currentSize * 2 : currentSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    // Obtener las coordenadas correctamente para ratón y pantalla táctil
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    
    // Restaurar el snapshot para dibujar sobre él
    if (snapshot) {
      ctx.putImageData(snapshot, 0, 0);
    }
    
    if (currentTool === "pencil" || currentTool === "eraser") {
      ctx.lineWidth = currentTool === "eraser" ? currentSize * 2 : currentSize;
      ctx.strokeStyle = currentTool === "eraser" ? "#ffffff" : currentColor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      
      // Dibujar la línea
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      
      // Enviar datos de dibujo en tiempo real
      const drawingData = {
        type: currentTool,
        x1: lastX,
        y1: lastY,
        x2: x,
        y2: y,
        color: currentTool === "eraser" ? "#ffffff" : currentColor,
        size: currentTool === "eraser" ? currentSize * 2 : currentSize
      };
      
      socket.emit("draw", drawingData);
      
      // Actualizar la última posición
      [lastX, lastY] = [x, y];
      
      // Actualizar el snapshot para el siguiente segmento de línea
      if (snapshot) {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } 
    else if (currentTool === "shape") {
      // Solo mostramos la vista previa de la forma, no la dibujamos todavía
      const color = currentTool === "eraser" ? "#ffffff" : currentColor;
      
      // Actualizar las coordenadas finales para la vista previa
      lastX = x;
      lastY = y;
      
      // Dibujar la vista previa de la forma
      drawShape(currentShape, startX, startY, x, y, color, currentSize, false, true);
    }
  }

  function stopDrawing(e) {
    if (!isDrawing) return;
    
    // Restaurar el canvas al estado original
    if (snapshot) {
      ctx.putImageData(snapshot, 0, 0);
    }
    
    // Si estamos en modo forma, guardar la forma dibujada
    if (currentTool === "shape") {
      // Obtener las coordenadas finales
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || (e.changedTouches && e.changedTouches[0].clientX) || lastX) - rect.left;
      const y = (e.clientY || (e.changedTouches && e.changedTouches[0].clientY) || lastY) - rect.top;
      
      // Solo guardar si se movió el ratón/dedo lo suficiente
      const minDistance = 5;
      if (Math.abs(x - startX) > minDistance || Math.abs(y - startY) > minDistance) {
        const drawingData = {
          type: 'shape',
          shape: currentShape,
          x1: startX,
          y1: startY,
          x2: x,
          y2: y,
          color: currentColor,
          size: currentSize
        };
        
        // Dibujar la forma final
        drawShape(currentShape, startX, startY, x, y, currentColor, currentSize, false, false);
        
        // Enviar a otros clientes
        socket.emit("draw", drawingData);
        
        // Agregar a la lista de dibujos
        drawings.push({
          type: 'shape',
          data: drawingData,
          timestamp: Date.now()
        });
      }
    }
    
    isDrawing = false;
    
    // Guardar el estado actual para deshacer
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // La función drawShape ya está definida arriba, la dejamos como está
  // Solo necesitamos asegurarnos de que las funciones de dibujo de formas estén definidas
  
  function drawLine(x1, y1, x2, y2, color, size) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.stroke();
  }
  
  function drawRect(x, y, width, height, color, size, fill = false) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (fill) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    } else {
      ctx.strokeRect(x, y, width, height);
    }
  }
  
  function drawCircle(x, y, radius, color, size, fill = false) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.stroke();
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

  // Manejar eventos de dibujo entrantes
  socket.on("draw", (data) => {
    if (!data) return;
    
    // Guardar en el historial de dibujos
    drawings.push({
      type: data.type,
      data: {...data},
      timestamp: Date.now()
    });
    
    // Guardar el estado actual del contexto
    const tempLineWidth = ctx.lineWidth;
    const tempStrokeStyle = ctx.strokeStyle;
    const tempFillStyle = ctx.fillStyle;
    const tempFont = ctx.font;
    
    // Procesar el dibujo
    switch(data.type) {
      case 'pencil':
      case 'eraser':
        if (data.x1 !== undefined && data.y1 !== undefined && 
            data.x2 !== undefined && data.y2 !== undefined) {
          ctx.beginPath();
          ctx.moveTo(data.x1, data.y1);
          ctx.lineTo(data.x2, data.y2);
          ctx.strokeStyle = data.color || '#000000';
          ctx.lineWidth = data.size || 5;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
        break;
        
      case 'shape':
        if (data.shape && data.x1 !== undefined && data.y1 !== undefined && 
            data.x2 !== undefined && data.y2 !== undefined) {
          drawShape(data.shape, data.x1, data.y1, data.x2, data.y2, 
                   data.color || '#000000', data.size || 5);
        }
        break;
        
      case 'text':
        if (data.text && data.x !== undefined && data.y !== undefined) {
          ctx.font = `${(data.size || 5) * 2}px Arial`;
          ctx.fillStyle = data.color || '#000000';
          ctx.fillText(data.text, data.x, (data.y || 0) + (data.size || 5) * 2);
        }
        break;
        
      case 'clear':
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawings = [];
        break;
    }
    
    // Restaurar el estado del contexto
    ctx.lineWidth = tempLineWidth;
    ctx.strokeStyle = tempStrokeStyle;
    ctx.fillStyle = tempFillStyle;
    ctx.font = tempFont;
  });

  socket.on("clear_canvas", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  socket.on("init_drawings", (savedDrawings) => {
    // Clear current canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Asegurarse de que savedDrawings sea un array
    const drawingsToLoad = Array.isArray(savedDrawings) ? savedDrawings : [];
    
    // Redraw all saved drawings
    drawingsToLoad.forEach((drawing) => {
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
