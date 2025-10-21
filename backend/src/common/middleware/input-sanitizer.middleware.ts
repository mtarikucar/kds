import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Input sanitization middleware
 * Sanitizes request body, query, and params to prevent XSS attacks
 */
@Injectable()
export class InputSanitizerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Sanitize body
    if (req.body) {
      req.body = this.sanitize(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = this.sanitize(req.query);
    }

    // Sanitize route parameters
    if (req.params) {
      req.params = this.sanitize(req.params);
    }

    next();
  }

  /**
   * Recursively sanitize object/array/string
   */
  private sanitize(data: any): any {
    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {};
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          // Sanitize both key and value
          const sanitizedKey = this.sanitizeString(key);
          sanitized[sanitizedKey] = this.sanitize(data[key]);
        }
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Sanitize string to prevent XSS
   * Escapes HTML special characters
   */
  private sanitizeString(str: string): string {
    if (typeof str !== 'string') {
      return str;
    }

    // Escape HTML special characters
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
}

/**
 * SQL Injection prevention middleware
 * Detects common SQL injection patterns
 */
@Injectable()
export class SqlInjectionPreventionMiddleware implements NestMiddleware {
  private readonly sqlPatterns = [
    /(\%27)|(\')|(\-\-)|(\%23)|(#)/gi, // SQL meta-characters
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/gi, // Typical SQL injection
    /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/gi, // union, select, etc.
    /((\%27)|(\'))union/gi,
    /exec(\s|\+)+(s|x)p\w+/gi,
  ];

  use(req: Request, res: Response, next: NextFunction): void {
    const suspicious = this.detectSqlInjection(req.body) ||
      this.detectSqlInjection(req.query) ||
      this.detectSqlInjection(req.params);

    if (suspicious) {
      res.status(400).json({
        statusCode: 400,
        message: 'Suspicious input detected',
        error: 'Bad Request',
        timestamp: new Date().toISOString(),
        path: req.url,
      });
      return;
    }

    next();
  }

  private detectSqlInjection(data: any): boolean {
    if (typeof data === 'string') {
      return this.sqlPatterns.some((pattern) => pattern.test(data));
    }

    if (Array.isArray(data)) {
      return data.some((item) => this.detectSqlInjection(item));
    }

    if (typeof data === 'object' && data !== null) {
      return Object.values(data).some((value) => this.detectSqlInjection(value));
    }

    return false;
  }
}
