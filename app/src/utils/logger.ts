import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { v4 as uuidv4 } from 'uuid'

// Configure structured logging with request ID support
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'websocket-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
})

// Helper function to create logger with request ID
export const createRequestLogger = (requestId: string) => {
  return logger.child({ request_id: requestId })
}

// Helper function to generate request ID
export const generateRequestId = () => uuidv4()

// Convenience logging functions
export const logInfo = (message: string, meta?: any) => logger.info(message, meta)
export const logError = (message: string, meta?: any) => logger.error(message, meta)
export const logWarn = (message: string, meta?: any) => logger.warn(message, meta)
export const logDebug = (message: string, meta?: any) => logger.debug(message, meta) 