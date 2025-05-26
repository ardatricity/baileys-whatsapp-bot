/**
 * Custom logger utilities
 */
import pino from 'pino';
import { config } from '../config';

// Initialize Pino logger for library logging
export const pinoLogger = pino({ 
  level: config.logger.level 
}).child({ module: 'bot' });

// Console logger with colors for more readable output
export const logger = {
  info: (message: string) => console.log(`\x1b[34m[INFO]\x1b[0m ${message}`),
  warn: (message: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${message}`),
  error: (message: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`),
  success: (message: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`),
  debug: (message: string) => {
    if (process.env.DEBUG === 'true') {
      console.log(`\x1b[36m[DEBUG]\x1b[0m ${message}`);
    }
  }
};
