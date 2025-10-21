import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join } from 'path';

/**
 * Custom Winston Logger Service
 * Provides structured logging with multiple transports
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor(context?: string) {
    this.context = context;
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const logDir = join(process.cwd(), 'logs');

    // Console format for development
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
        const ctx = context || this.context || 'App';
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}] [${ctx}] ${message} ${metaStr}`;
      }),
    );

    // JSON format for production
    const jsonFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

    // Transports
    const transports: winston.transport[] = [];

    // Console transport (always)
    transports.push(
      new winston.transports.Console({
        format: process.env.NODE_ENV === 'production' ? jsonFormat : consoleFormat,
      }),
    );

    // File transports (only in production or if LOG_TO_FILE=true)
    if (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
      // Error log file
      transports.push(
        new DailyRotateFile({
          dirname: logDir,
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '14d',
          format: jsonFormat,
        }),
      );

      // Combined log file
      transports.push(
        new DailyRotateFile({
          dirname: logDir,
          filename: 'combined-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: jsonFormat,
        }),
      );

      // Access log file (HTTP requests)
      transports.push(
        new DailyRotateFile({
          dirname: logDir,
          filename: 'access-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '7d',
          level: 'http',
          format: jsonFormat,
        }),
      );
    }

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: jsonFormat,
      transports,
      exitOnError: false,
    });
  }

  /**
   * Set context for subsequent log calls
   */
  setContext(context: string) {
    this.context = context;
  }

  /**
   * Log a message
   */
  log(message: string, context?: string) {
    this.logger.info(message, { context: context || this.context });
  }

  /**
   * Log an error
   */
  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, {
      context: context || this.context,
      trace,
    });
  }

  /**
   * Log a warning
   */
  warn(message: string, context?: string) {
    this.logger.warn(message, { context: context || this.context });
  }

  /**
   * Log debug information
   */
  debug(message: string, context?: string) {
    this.logger.debug(message, { context: context || this.context });
  }

  /**
   * Log verbose information
   */
  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context: context || this.context });
  }

  /**
   * Log HTTP request
   */
  http(message: string, meta?: any) {
    this.logger.log('http', message, { ...meta, context: this.context });
  }

  /**
   * Log with custom level
   */
  logWithLevel(level: string, message: string, meta?: any) {
    this.logger.log(level, message, { ...meta, context: this.context });
  }

  /**
   * Log structured data
   */
  logObject(level: string, message: string, obj: any, context?: string) {
    this.logger.log(level, message, {
      ...obj,
      context: context || this.context,
    });
  }
}
