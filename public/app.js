// Función para inicializar la aplicación
function initApp() {
  // Verificar que Socket.IO esté disponible
  if (typeof io === "undefined") {
    //console.error("Error: Socket.IO no se ha cargado correctamente");
    document.getElementById("status").textContent =
      "Error: No se pudo cargar Socket.IO";
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
    path: "/socket.io/",
    // Usar el protocolo actual (http o https) basado en la página actual
    secure: window.location.protocol === "https:",
    // Usar polling primero para la conexión inicial
    transports: ["polling", "websocket"],
    // Configuración de reconexión
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Timeout de conexión
    timeout: 20000,
    // En producción, verificar certificados. En desarrollo, permitir certificados autofirmados
    rejectUnauthorized:
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1",
    // Forzar el uso de WebSocket después de la conexión inicial
    upgrade: true,
    // Deshabilitar la compresión
    perMessageDeflate: false,
    // Configuración de consulta para depuración
    query: {
      t: Date.now(), // Evitar caché
      debug: "true",
    },
  });

  // Verificar si hay una sesión guardada
  const sessionId = localStorage.getItem("pizarra_session_id");

  // Verificar conexión
  socket.on("connect", () => {
    //console.log("Conectado al servidor de sockets con ID:", socket.id);

    // Enviar el ID de sesión al servidor (si existe)
    socket.emit("join_session", { sessionId });
  });

  // Manejar respuesta del servidor sobre la sesión
  socket.on("session_status", (data) => {
    if (data.sessionExists) {
      //console.log('Unido a la sesión existente:', data.sessionId);
      // Guardar el ID de sesión si no lo teníamos
      if (!sessionId) {
        localStorage.setItem("pizarra_session_id", data.sessionId);
      }
      // Si hay dibujos previos, solicitarlos
      if (data.hasDrawings) {
        socket.emit("request_redraw");
      }
    } else {
      //console.log('Nueva sesión creada:', data.sessionId);
      // Guardar el nuevo ID de sesión
      localStorage.setItem("pizarra_session_id", data.sessionId);
    }

    // Actualizar la interfaz de usuario según sea necesario
    statusEl.textContent = `Sesión: ${data.sessionId.substring(0, 8)}...`;
  });

  socket.on("connect_error", (error) => {
    //console.error("Error de conexión:", error);
    statusEl.textContent = "Error de conexión. Reconectando...";
    //console.log("Intentando reconectar...");
  });

  // Depuración
  //console.log("Conectando a Socket.IO en:", window.SERVER_URL);
  /*console.log("Configuración del socket:", {
    secure: window.location.protocol === "https:",
    hostname: window.location.hostname,
    port: window.location.port,
  });*/

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
  function drawShape(
    shape,
    x1,
    y1,
    x2,
    y2,
    color,
    size,
    fill = false,
    isPreview = false
  ) {
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Si es una vista previa, usar un estilo semitransparente
    if (isPreview) {
      ctx.strokeStyle = color.replace(")", ", 0.5)").replace("rgb", "rgba");
      ctx.fillStyle = color.replace(")", ", 0.2)").replace("rgb", "rgba");
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    switch (shape) {
      case "rectangle":
        if (fill) ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        else ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
      case "circle":
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        ctx.beginPath();
        ctx.arc(x1, y1, radius, 0, Math.PI * 2);
        if (fill) ctx.fill();
        else ctx.stroke();
        break;
      case "line":
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      case "arrow":
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

    // Obtener la posición del canvas en la página
    const canvasRect = canvas.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    // Calcular la posición absoluta en la página
    const posX = x + canvasRect.left + scrollX;
    const posY = y + canvasRect.top + scrollY;

    // Calcular el tamaño de fuente (asegurándonos de que sea al menos 12px)
    const fontSize = Math.max(12, currentSize * 2);

    // Crear el input de texto
    textInput = document.createElement("input");
    textInput.type = "text";
    textInput.style.position = "fixed";
    textInput.style.left = `${posX}px`;
    textInput.style.top = `${posY}px`;
    textInput.style.border = "2px solid #3498db";
    textInput.style.borderRadius = "4px";
    textInput.style.padding = "8px 12px";
    textInput.style.font = `${fontSize}px Arial`;
    textInput.style.color = currentColor;
    textInput.style.background = "white";
    textInput.style.zIndex = "10000";
    textInput.style.minWidth = "150px";
    textInput.style.outline = "none";
    textInput.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
    textInput.style.lineHeight = "1.2"; // Asegurar un espaciado adecuado

    // Función para manejar el teclado
    const handleKeyDown = (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();

        if (e.key === "Enter" && textInput.value.trim()) {
          // Dibujar el texto en el canvas
          const fontSize = Math.max(12, currentSize * 2);
          ctx.font = `${fontSize}px Arial`;
          ctx.fillStyle = currentColor;
          // Ajustar la posición vertical para que el texto no se dibuje muy arriba
          ctx.textBaseline = "top";
          ctx.fillText(textInput.value, x, y);

          // Enviar el texto a otros clientes
          socket.emit("draw", {
            type: "text",
            x,
            y,
            text: textInput.value,
            color: currentColor,
            size: currentSize,
          });
        }

        // Limpiar
        document.body.removeChild(textInput);
        textInput = null;
        document.removeEventListener("keydown", handleKeyDown);
      }
    };

    // Agregar el input al documento
    document.body.appendChild(textInput);

    // Enfocar el input después de un pequeño retraso
    setTimeout(() => {
      if (textInput) {
        try {
          textInput.focus();
        } catch (e) {
          //console.error("Error al enfocar el input:", e);
        }
      }
    }, 10);

    // Agregar el event listener para el teclado
    document.addEventListener("keydown", handleKeyDown);
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

  // Agregar manejador para el bote de pintura
  const paintBucketBtn = document.getElementById("paintBucket");
  paintBucketBtn.addEventListener("click", () => {
    currentTool = "paintBucket";
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

  // Manejar el cambio de tamaño del pincel
  brushSize.addEventListener("input", (e) => {
    currentSize = parseInt(e.target.value);
    brushSizeValue.textContent = `${currentSize}px`;

    // Si hay un input de texto activo, actualizar su tamaño de fuente
    if (textInput) {
      const fontSize = Math.max(12, currentSize * 2);
      textInput.style.font = `${fontSize}px Arial`;
    }
  });

  // Función para implementar el algoritmo de relleno de inundación (flood fill)
  function floodFill(x, y, targetColor, fillColor) {
    // Obtener los datos de píxeles del canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    // Convertir coordenadas a índices de píxel
    const index = (y * width + x) * 4;
    const targetR = pixels[index];
    const targetG = pixels[index + 1];
    const targetB = pixels[index + 2];
    const targetA = pixels[index + 3];

    // Si el color de relleno es igual al color objetivo, no hacer nada
    if (
      fillColor === `rgba(${targetR}, ${targetG}, ${targetB}, ${targetA / 255})`
    ) {
      return;
    }

    // Convertir el color de relleno a RGBA
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = fillColor;
    tempCtx.fillRect(0, 0, 1, 1);
    const fillData = tempCtx.getImageData(0, 0, 1, 1).data;

    // Crear una matriz para rastrear píxeles visitados
    const visited = new Array(width * height).fill(false);
    const stack = [];
    stack.push({ x, y });

    // Algoritmo de relleno de inundación (flood fill)
    while (stack.length > 0) {
      const { x: currentX, y: currentY } = stack.pop();
      const currentIndex = (currentY * width + currentX) * 4;

      // Verificar límites
      if (
        currentX < 0 ||
        currentX >= width ||
        currentY < 0 ||
        currentY >= height
      ) {
        continue;
      }

      // Verificar si ya fue visitado
      if (visited[currentY * width + currentX]) {
        continue;
      }

      // Obtener el color del píxel actual
      const r = pixels[currentIndex];
      const g = pixels[currentIndex + 1];
      const b = pixels[currentIndex + 2];
      const a = pixels[currentIndex + 3];

      // Verificar si el color coincide con el objetivo
      if (r === targetR && g === targetG && b === targetB && a === targetA) {
        // Establecer el nuevo color
        pixels[currentIndex] = fillData[0]; // R
        pixels[currentIndex + 1] = fillData[1]; // G
        pixels[currentIndex + 2] = fillData[2]; // B
        pixels[currentIndex + 3] = fillData[3]; // A

        // Marcar como visitado
        visited[currentY * width + currentX] = true;

        // Agregar vecinos a la pila
        if (currentX > 0) stack.push({ x: currentX - 1, y: currentY });
        if (currentX < width - 1) stack.push({ x: currentX + 1, y: currentY });
        if (currentY > 0) stack.push({ x: currentX, y: currentY - 1 });
        if (currentY < height - 1) stack.push({ x: currentX, y: currentY + 1 });
      }
    }

    // Aplicar los cambios al canvas
    ctx.putImageData(imageData, 0, 0);
  }

  function updateToolUI() {
    // Actualizar la interfaz de usuario según la herramienta seleccionada
    pencilBtn.classList.toggle("active", currentTool === "pencil");
    eraserBtn.classList.toggle("active", currentTool === "eraser");
    textBtn.classList.toggle("active", currentTool === "text");
    paintBucketBtn.classList.toggle("active", currentTool === "paintBucket");

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
    switch (currentTool) {
      case "pencil":
        canvas.style.cursor =
          "url(\"data:image/svg+xml;utf8,\
          <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>\
          <g transform='rotate(45 16 16)'>\
            <!-- Goma -->\
            <rect x='14' y='0' width='4' height='4' fill='%23ff9999' stroke='%23000' stroke-width='1'/>\
            <!-- Aro metálico -->\
            <rect x='14' y='4' width='4' height='2' fill='%23ccc' stroke='%23000' stroke-width='1'/>\
            <!-- Cuerpo -->\
            <rect x='14' y='6' width='4' height='16' fill='%23ffcc00' stroke='%23000' stroke-width='1'/>\
            <!-- Punta de madera -->\
            <polygon points='14,22 18,22 16,28' fill='%23d2b48c' stroke='%23000' stroke-width='1'/>\
            <!-- Mina -->\
            <polygon points='15,26 17,26 16,28' fill='%23999' stroke='%23000' stroke-width='1'/>\
          </g>\
          </svg>\") 28 28, auto";
        break;
      case "eraser":
        canvas.style.cursor =
          "url(\"data:image/svg+xml;utf8,\
          <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>\
          <g transform='rotate(45 16 16)'>\
            <!-- Mitad roja -->\
            <rect x='12' y='0' width='8' height='8' fill='%23ff4d4d' stroke='%23fff' stroke-width='1'/>\
            <!-- Mitad azul -->\
            <rect x='12' y='8' width='8' height='8' fill='%234d88ff' stroke='%23fff' stroke-width='1'/>\
            <!-- Contorno general -->\
            <rect x='12' y='0' width='8' height='16' fill='none' stroke='%23fff' stroke-width='1'/>\
          </g>\
          </svg>\") 28 28, auto";
        break;
      case "text":
        canvas.style.cursor = "text";
        break;
      case "shape":
        canvas.style.cursor = "crosshair";
        break;
      case "paintBucket":
        canvas.style.cursor =
          "url(\"data:image/svg+xml;utf8,\
          <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>\
            <g transform='rotate(-25 16 16)'>\
              <!-- asa -->\
              <path d='M6 10c0-3 3-5 6-5' fill='none' stroke='%23000' stroke-width='1.6' stroke-linecap='round'/>\
              <!-- borde superior (boca) -->\
              <ellipse cx='18' cy='9' rx='6.5' ry='3.3' fill='%239aa3c7' stroke='%23000' stroke-width='1.6'/>\
              <!-- cuerpo del balde -->\
              <path d='M12 10 L6 16 Q5 17 6.5 19 L14 27 Q16 29 19 29 T24 27 L28 23 Q30 21 29 18 L25 12 Z'\
                    fill='%23d7ddea' stroke='%23000' stroke-width='1.6'/>\
              <!-- etiqueta/agarre -->\
              <rect x='16' y='16' width='6' height='4' transform='rotate(-15 19 18)'\
                    fill='%23e46b6b' stroke='%23000' stroke-width='1.6' rx='0.8'/>\
            </g>\
            <!-- gota -->\
            <path d='M7 27 C7 24 10 23 10 21 C12 23 13 24 13 26 C13 28.2 11.6 30 10 30 C8.4 30 7 28.6 7 27 Z'\
                  fill='%23e46b6b' stroke='%23000' stroke-width='1.2'/>\
          </svg>\") 4 30, auto";
        break;
      default:
        canvas.style.cursor = "default";
    }
  }

  // Drawing functions
  function startDrawing(e) {
    // Obtener las coordenadas correctamente para ratón o pantalla táctil
    const { x, y } = getCoords(e);

    // Manejar clic del bote de pintura
    if (currentTool === "paintBucket") {
      e.preventDefault();

      // Guardar el estado actual para deshacer
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Aplicar el relleno de pintura
      floodFill(Math.floor(x), Math.floor(y), null, currentColor);

      // Enviar el evento de relleno a otros clientes
      socket.emit("draw", {
        type: "fill",
        x: Math.floor(x),
        y: Math.floor(y),
        color: currentColor,
      });

      // Agregar a la lista de dibujos
      drawings.push({
        type: "fill",
        data: {
          x: Math.floor(x),
          y: Math.floor(y),
          color: currentColor,
        },
        timestamp: Date.now(),
      });

      return;
    }

    if (currentTool === "text") {
      e.preventDefault(); // Prevenir selección de texto
      addText(x, y);
      return;
    }

    isDrawing = true;

    [startX, startY] = [x, y];
    [lastX, lastY] = [x, y];

    // Guardar el estado actual del canvas para deshacer
    if (
      currentTool === "pencil" ||
      currentTool === "eraser" ||
      currentTool === "shape"
    ) {
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Si es lápiz o borrador, comenzar un nuevo trazo
      if (currentTool === "pencil" || currentTool === "eraser") {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = currentTool === "eraser" ? "#ffffff" : currentColor;
        ctx.lineWidth =
          currentTool === "eraser" ? currentSize * 2 : currentSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();

    // Obtener coordenadas para ratón o pantalla táctil
    const { x, y } = getCoords(e);

    if (currentTool === "pencil" || currentTool === "eraser") {
      // Configurar el estilo del trazo
      ctx.lineWidth = currentTool === "eraser" ? currentSize * 2 : currentSize;
      ctx.strokeStyle = currentTool === "eraser" ? "#ffffff" : currentColor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Si es el primer punto, solo movemos a la posición
      if (lastX === null || lastY === null) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        //console.log("Iniciando nuevo trazo en:", { x, y });
      } else {
        // Dibujar una línea desde la última posición a la actual
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Enviar el trazo al servidor
        const drawingData = {
          type: currentTool,
          x1: lastX,
          y1: lastY,
          x2: x,
          y2: y,
          color: currentColor,
          size: currentSize,
        };

        //console.log("Enviando trazo al servidor:", drawingData);
        socket.emit("draw", drawingData, (response) => {
          //console.log('Respuesta del servidor:', response);
        });
      }

      // Actualizar la última posición
      lastX = x;
      lastY = y;

      // Guardar el estado actual para la siguiente iteración
      if (snapshot) {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } else if (currentTool === "shape") {
      // Restaurar el snapshot para la vista previa de formas
      if (snapshot) {
        ctx.putImageData(snapshot, 0, 0);
      }
      // Vista previa de formas
      drawShape(
        currentShape,
        startX,
        startY,
        x,
        y,
        currentColor,
        currentSize,
        false,
        true
      );
    }
  }

  function stopDrawing(e) {
    if (!isDrawing) return;

    // Restaurar el canvas al estado original
    if (snapshot) {
      ctx.putImageData(snapshot, 0, 0);
    }

    // Reiniciar las últimas coordenadas
    lastX = null;
    lastY = null;

    // Si estamos en modo forma, guardar la forma dibujada
    if (currentTool === "shape") {
      // Obtener las coordenadas finales
      const { x, y } = e ? getCoords(e) : { x: lastX, y: lastY };

      // Solo guardar si se movió el ratón/dedo lo suficiente
      const minDistance = 5;
      if (
        Math.abs(x - startX) > minDistance ||
        Math.abs(y - startY) > minDistance
      ) {
        const drawingData = {
          type: "shape",
          shape: currentShape,
          x1: startX,
          y1: startY,
          x2: x,
          y2: y,
          color: currentColor,
          size: currentSize,
        };

        // Dibujar la forma final
        drawShape(
          currentShape,
          startX,
          startY,
          x,
          y,
          currentColor,
          currentSize,
          false,
          false
        );

        // Enviar a otros clientes
        socket.emit("draw", drawingData);

        // Agregar a la lista de dibujos
        drawings.push({
          type: "shape",
          data: drawingData,
          timestamp: Date.now(),
        });
      }
    }

    isDrawing = false;

    // Guardar el estado actual para deshacer
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // Función para obtener las coordenadas correctas del evento (táctil o ratón)
  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    let x, y;

    // Manejar eventos táctiles
    if (e.touches && e.touches[0]) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    }
    // Manejar eventos de ratón
    else {
      x = e.offsetX || e.clientX - rect.left;
      y = e.offsetY || e.clientY - rect.top;
    }

    // Asegurarse de que las coordenadas estén dentro de los límites del canvas
    x = Math.max(0, Math.min(x, canvas.width));
    y = Math.max(0, Math.min(y, canvas.height));

    return { x, y };
  }

  // Event listeners para ratón
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);

  // Event listeners para pantallas táctiles
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd);

  // Prevenir el comportamiento táctil por defecto (como el desplazamiento)
  function preventDefault(e) {
    if (e.touches.length > 1) return; // Permitir gestos de zoom
    e.preventDefault();
  }

  // Agregar manejadores para los eventos de toque
  function handleTouchStart(e) {
    preventDefault(e);
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function handleTouchMove(e) {
    preventDefault(e);
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function handleTouchEnd(e) {
    preventDefault(e);
    const mouseEvent = new MouseEvent("mouseup", {});
    canvas.dispatchEvent(mouseEvent);
  }

  // Clear canvas - Ahora cualquier usuario puede borrar la pizarra
  clearBtn.addEventListener("click", () => {
    if (
      confirm(
        "¿Estás seguro de que quieres borrar todo el contenido de la pizarra?"
      )
    ) {
      // Crear el evento de limpieza
      const clearEvent = {
        type: "clear",
        timestamp: Date.now(),
        userId: socket.id || "usuario_desconocido",
      };

      // Limpiar localmente primero para mejor experiencia de usuario
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawings = [
        {
          type: "clear",
          data: { ...clearEvent },
          timestamp: clearEvent.timestamp,
          userId: clearEvent.userId,
        },
      ];

      //console.log("Enviando solicitud de limpieza al servidor", clearEvent);

      // Enviar el evento de limpieza al servidor
      socket.emit(
        "draw",
        {
          type: "clear",
          userId: clearEvent.userId,
          timestamp: clearEvent.timestamp,
        },
        (response) => {
          if (response && response.status === "ok") {
            //console.log("Limpieza confirmada por el servidor");
          } else {
            //console.warn("No se pudo confirmar la limpieza con el servidor");
            // Opcional: Revertir la limpieza local si falla en el servidor
          }
        }
      );
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
    //console.log("Conectado al servidor con ID:", socket.id);
    statusEl.textContent = "Conectado";
    statusEl.style.color = "#2ecc71";

    // Solicitar los dibujos actuales al reconectar
    if (socket.recovered) {
      //console.log("Conexión recuperada, solicitando dibujos actuales...");
      socket.emit("request_redraw");
    }
  });

  socket.on("disconnect", (reason) => {
    //console.log("Desconectado del servidor:", reason);
    statusEl.textContent = "Desconectado";
    statusEl.style.color = "#e74c3c";
  });

  socket.on("connect_error", (error) => {
    //console.error("Error de conexión:", error);
    statusEl.textContent = "Error de conexión";
    statusEl.style.color = "#e74c3c";

    // Intentar reconectar después de un retraso
    setTimeout(() => {
      //console.log("Intentando reconectar...");
      socket.connect();
    }, 2000);
  });

  // Configurar reconexión automática
  socket.io.on("reconnect_attempt", (attempt) => {
    //console.log(`Intento de reconexión #${attempt}`);
  });

  socket.io.on("reconnect", (attempt) => {
    //console.log(`Reconectado después de ${attempt} intentos`);
  });

  socket.io.on("reconnect_error", (error) => {
    //console.error("Error al reconectar:", error);
  });

  // Manejar el evento de reconexión exitosa
  socket.io.on("reconnect_failed", () => {
    //console.error("No se pudo reconectar al servidor");
    statusEl.textContent = "Error de conexión";
    statusEl.style.color = "#e74c3c";
  });

  // Manejar eventos de dibujo entrantes
  socket.on("draw", (drawingData) => {
    if (!drawingData || !drawingData.type) {
      //console.warn("Datos de dibujo inválidos recibidos:", drawingData);
      return;
    }

    // No procesar si el dibujo es del propio usuario (ya se dibujó localmente)
    if (drawingData.userId === socket.id) {
      return;
    }

    /*console.log("Dibujo recibido de otro usuario:", {
      type: drawingData.type,
      id: drawingData.id,
      from: drawingData.userId,
      session: drawingData.sessionId
    });*/

    // Guardar el estado actual del contexto
    const tempLineWidth = ctx.lineWidth;
    const tempStrokeStyle = ctx.strokeStyle;
    const tempFillStyle = ctx.fillStyle;
    const tempFont = ctx.font;
    const tempLineCap = ctx.lineCap;
    const tempLineJoin = ctx.lineJoin;

    try {
      // Procesar el dibujo
      switch (drawingData.type) {
        case "pencil":
        case "eraser":
          if (
            drawingData.x1 !== undefined &&
            drawingData.y1 !== undefined &&
            drawingData.x2 !== undefined &&
            drawingData.y2 !== undefined
          ) {
            // Configurar el estilo del trazo
            ctx.beginPath();
            ctx.moveTo(drawingData.x1, drawingData.y1);
            ctx.lineTo(drawingData.x2, drawingData.y2);
            ctx.strokeStyle =
              drawingData.type === "eraser"
                ? "#ffffff"
                : drawingData.color || "#000000";
            ctx.lineWidth =
              drawingData.type === "eraser"
                ? (drawingData.size || 10) * 2
                : drawingData.size || 5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();

            // Agregar al historial local
            drawings.push({
              type: drawingData.type,
              data: { ...drawingData },
              timestamp: drawingData.timestamp || Date.now(),
            });
          }
          break;

        case "shape":
          if (
            drawingData.shape &&
            drawingData.x1 !== undefined &&
            drawingData.y1 !== undefined &&
            drawingData.x2 !== undefined &&
            drawingData.y2 !== undefined
          ) {
            drawShape(
              drawingData.shape,
              drawingData.x1,
              drawingData.y1,
              drawingData.x2,
              drawingData.y2,
              drawingData.color || "#000000",
              drawingData.size || 5,
              drawingData.fill || false
            );

            // Agregar al historial local
            drawings.push({
              type: drawingData.type,
              data: { ...drawingData },
              timestamp: drawingData.timestamp || Date.now(),
            });
          }
          break;

        case "text":
          if (
            drawingData.text &&
            drawingData.x !== undefined &&
            drawingData.y !== undefined
          ) {
            const fontSize = Math.max(12, (drawingData.size || 5) * 2);
            ctx.font = `${fontSize}px Arial`;
            ctx.fillStyle = drawingData.color || "#000000";
            ctx.textBaseline = "top";
            ctx.fillText(drawingData.text, drawingData.x, drawingData.y);

            // Agregar al historial local
            drawings.push({
              type: drawingData.type,
              data: { ...drawingData },
              timestamp: drawingData.timestamp || Date.now(),
            });
          }
          break;

        case "fill":
          if (
            drawingData.x !== undefined &&
            drawingData.y !== undefined &&
            drawingData.color
          ) {
            floodFill(
              Math.floor(drawingData.x),
              Math.floor(drawingData.y),
              null,
              drawingData.color
            );

            // Agregar al historial local
            drawings.push({
              type: drawingData.type,
              data: { ...drawingData },
              timestamp: drawingData.timestamp || Date.now(),
            });
          }
          break;

        case "clear":
          // 1. Primero, limpiar el canvas visualmente
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // 2. Crear el evento de limpieza
          const clearEvent = {
            type: "clear",
            data: { ...drawingData },
            timestamp: drawingData.timestamp || Date.now(),
            userId: drawingData.userId || "usuario_desconocido",
          };

          // 3. Limpiar el array de dibujos locales, manteniendo solo el evento de limpieza
          drawings = [clearEvent];

          //console.log("Canvas limpiado por:", clearEvent.userId);

          // 4. Forzar un redibujado completo del canvas
          // Esto asegura que cualquier operación pendiente se complete
          setTimeout(() => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }, 0);

          return; // No necesitamos hacer más nada
      }
    } catch (error) {
      //console.error("Error al procesar el dibujo remoto:", error, drawingData);
    } finally {
      // Restaurar el estado del contexto
      ctx.lineWidth = tempLineWidth;
      ctx.strokeStyle = tempStrokeStyle;
      ctx.fillStyle = tempFillStyle;
      ctx.font = tempFont;
      ctx.lineCap = tempLineCap;
      ctx.lineJoin = tempLineJoin;
    }
  });

  // El evento clear_canvas ha sido reemplazado por el evento 'draw' con type: 'clear'
  // El manejador de eventos 'draw' ya maneja el tipo 'clear'

  // Manejador de sesión reemplazada (sin alerta)
  socket.on("session_replaced", () => {
    window.location.reload();
  });

  // Manejar la inicialización de dibujos al unirse a una sesión
  socket.on("init_drawings", (data) => {
    try {
      /*console.log("Recibiendo dibujos guardados:", {
        sessionId: data.sessionId,
        totalDrawings: data.totalDrawings || 0,
        hasClear: data.lastClear || false,
        timestamp: new Date(data.timestamp).toISOString()
      });*/

      // Limpiar el canvas actual
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Inicializar el array de dibujos
      drawings = [];

      // Asegurarse de que data.drawings sea un array
      const drawingsToLoad = Array.isArray(data.drawings) ? data.drawings : [];

      // Si no hay dibujos, terminar
      if (drawingsToLoad.length === 0) {
        //console.log("No hay dibujos para cargar");
        return;
      }

      //console.log(`Cargando ${drawingsToLoad.length} dibujos...`);

      // Procesar los dibujos en orden cronológico
      const sortedDrawings = [...drawingsToLoad].sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
      );

      // Si hay un evento de limpieza, solo mantener el más reciente
      const clearEvents = sortedDrawings.filter((d) => d.type === "clear");
      const lastClearEvent =
        clearEvents.length > 0 ? clearEvents[clearEvents.length - 1] : null;

      // Filtrar los dibujos para incluir solo los posteriores al último clear
      const drawingsAfterLastClear = lastClearEvent
        ? sortedDrawings.filter((d) => d.timestamp >= lastClearEvent.timestamp)
        : sortedDrawings;

      //console.log(`Mostrando ${drawingsAfterLastClear.length} dibujos (después de limpiezas)...`);

      // Guardar el estado actual del contexto
      const tempLineWidth = ctx.lineWidth;
      const tempStrokeStyle = ctx.strokeStyle;
      const tempFillStyle = ctx.fillStyle;
      const tempFont = ctx.font;
      const tempLineCap = ctx.lineCap;
      const tempLineJoin = ctx.lineJoin;

      try {
        // Procesar cada dibujo
        drawingsAfterLastClear.forEach((drawing) => {
          if (!drawing || !drawing.type) return;

          // Guardar el dibujo en el historial local
          drawings.push({
            type: drawing.type,
            data: { ...drawing },
            timestamp: drawing.timestamp || Date.now(),
          });

          // Procesar el dibujo según su tipo
          switch (drawing.type) {
            case "pencil":
            case "eraser":
              if (
                drawing.x1 !== undefined &&
                drawing.y1 !== undefined &&
                drawing.x2 !== undefined &&
                drawing.y2 !== undefined
              ) {
                ctx.beginPath();
                ctx.moveTo(drawing.x1, drawing.y1);
                ctx.lineTo(drawing.x2, drawing.y2);
                ctx.strokeStyle =
                  drawing.type === "eraser"
                    ? "#ffffff"
                    : drawing.color || "#000000";
                ctx.lineWidth =
                  drawing.type === "eraser"
                    ? (drawing.size || 10) * 2
                    : drawing.size || 5;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.stroke();
              }
              break;

            case "shape":
              if (
                drawing.shape &&
                drawing.x1 !== undefined &&
                drawing.y1 !== undefined &&
                drawing.x2 !== undefined &&
                drawing.y2 !== undefined
              ) {
                drawShape(
                  drawing.shape,
                  drawing.x1,
                  drawing.y1,
                  drawing.x2,
                  drawing.y2,
                  drawing.color || "#000000",
                  drawing.size || 5,
                  drawing.fill || false
                );
              }
              break;

            case "text":
              if (
                drawing.text &&
                drawing.x !== undefined &&
                drawing.y !== undefined
              ) {
                const fontSize = Math.max(12, (drawing.size || 5) * 2);
                ctx.font = `${fontSize}px Arial`;
                ctx.fillStyle = drawing.color || "#000000";
                ctx.textBaseline = "top";
                ctx.fillText(drawing.text, drawing.x, drawing.y);
              }
              break;

            case "fill":
              if (
                drawing.x !== undefined &&
                drawing.y !== undefined &&
                drawing.color
              ) {
                floodFill(
                  Math.floor(drawing.x),
                  Math.floor(drawing.y),
                  null,
                  drawing.color
                );
              }
              break;

            case "clear":
              // Limpiar el canvas visualmente
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              break;
          }
        });

        //console.log("Dibujos cargados correctamente");
      } catch (error) {
        //console.error("Error al procesar los dibujos:", error);
      } finally {
        // Restaurar el estado del contexto
        ctx.lineWidth = tempLineWidth;
        ctx.strokeStyle = tempStrokeStyle;
        ctx.fillStyle = tempFillStyle;
        ctx.font = tempFont;
        ctx.lineCap = tempLineCap;
        ctx.lineJoin = tempLineJoin;
      }
    } catch (error) {
      //console.error("Error al cargar dibujos guardados:", error);
    }
  });

  // Manejador para cuando el cliente es designado como creador
  socket.on("set_creator", () => {
    isCreator = true;
    clearBtn.disabled = false;
    statusEl.textContent = "Conectado (Creador)";
  });

  // Inicializar la interfaz de usuario
  updateToolUI();
  brushSizeValue.textContent = `${currentSize}px`;
}

// Inicializar la aplicación cuando el DOM esté completamente cargado
document.addEventListener("DOMContentLoaded", initApp);
