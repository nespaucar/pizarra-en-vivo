// Configuración de entorno
const isProduction = process.env.NODE_ENV === 'production';

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// Formateador de fecha
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString();
};

// Función de registro condicional para el servidor
const serverLogger = {
  log: (...args) => !isProduction && console.log(`${colors.cyan}[${getTimestamp()}]${colors.reset}`, ...args),
  info: (...args) => console.info(`${colors.blue}[${getTimestamp()}] [INFO]${colors.reset}`, ...args),
  warn: (...args) => console.warn(`${colors.yellow}[${getTimestamp()}] [WARN]${colors.reset}`, ...args),
  error: (...args) => console.error(`${colors.red}[${getTimestamp()}] [ERROR]${colors.reset}`, ...args),
  debug: (...args) => !isProduction && console.debug(`${colors.gray}[${getTimestamp()}] [DEBUG]${colors.reset}`, ...args),
  success: (...args) => console.log(`${colors.green}[${getTimestamp()}] [SUCCESS]${colors.reset}`, ...args)
};

// Función de registro condicional para el cliente
const clientLogger = {
  log: (...args) => {
    if (typeof window !== 'undefined' && !isProduction) {
      console.log(`%c[${getTimestamp()}]`, 'color: #00bcd4', ...args);
    }
  },
  info: (...args) => {
    if (typeof window !== 'undefined') {
      console.info(`%c[${getTimestamp()}] [INFO]`, 'color: #2196f3', ...args);
    }
  },
  warn: (...args) => {
    if (typeof window !== 'undefined') {
      console.warn(`%c[${getTimestamp()}] [WARN]`, 'color: #ff9800', ...args);
    }
  },
  error: (...args) => {
    if (typeof window !== 'undefined') {
      console.error(`%c[${getTimestamp()}] [ERROR]`, 'color: #f44336', ...args);
    }
  },
  debug: (...args) => {
    if (typeof window !== 'undefined' && !isProduction) {
      console.debug(`%c[${getTimestamp()}] [DEBUG]`, 'color: #9e9e9e', ...args);
    }
  },
  success: (...args) => {
    if (typeof window !== 'undefined') {
      console.log(`%c[${getTimestamp()}] [SUCCESS]`, 'color: #4caf50', ...args);
    }
  }
};

module.exports = {
  server: serverLogger,
  client: clientLogger,
  isProduction
};
