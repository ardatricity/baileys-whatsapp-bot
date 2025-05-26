/**
 * Application configuration module
 */
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export const config = {
  // Database
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp-bot'
  },
  
  // WhatsApp
  whatsapp: {
    authDir: path.join(process.cwd(), 'auth_info_baileys'),
    targetKeyword: 'neol', // Keyword to identify groups to monitor
    markOnlineOnConnect: false
  },
  
  // Logging
  logger: {
    level: process.env.LOG_LEVEL || 'warn'
  }
};
