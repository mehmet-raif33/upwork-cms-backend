// Logger utility for backend with environment-based logging
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Log levels: DEBUG < INFO < WARN < ERROR < CRITICAL
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

// Set log level based on environment
const CURRENT_LOG_LEVEL = IS_PRODUCTION 
  ? LOG_LEVELS.ERROR  // Only errors and critical in production
  : IS_TEST 
    ? LOG_LEVELS.WARN  // Warn+ in test
    : LOG_LEVELS.DEBUG; // Everything in development

class Logger {
  formatMessage(level, message, context = null) {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }

  shouldLog(level) {
    return LOG_LEVELS[level] >= CURRENT_LOG_LEVEL;
  }

  debug(message, context = null) {
    if (this.shouldLog('DEBUG')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message, context = null) {
    if (this.shouldLog('INFO')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message, context = null) {
    if (this.shouldLog('WARN')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message, error = null, context = null) {
    if (this.shouldLog('ERROR')) {
      console.error(this.formatMessage('error', message, context));
      if (error) {
        console.error(error);
      }
    }
  }

  // Always log critical errors regardless of environment
  critical(message, error = null, context = null) {
    console.error(this.formatMessage('critical', message, context));
    if (error) {
      console.error(error);
    }
  }

  // API request logging (only in development)
  apiRequest(method, url, userId = null, context = null) {
    if (IS_DEVELOPMENT) {
      this.info(`${method} ${url}`, { userId, ...context });
    }
  }

  // API response logging (only in development)
  apiResponse(method, url, statusCode, responseTime = null, context = null) {
    if (IS_DEVELOPMENT) {
      this.info(`${method} ${url} - ${statusCode}`, { responseTime, ...context });
    }
  }
}

// Export singleton instance
const logger = new Logger();

module.exports = logger; 