/**
 * WhatsApp authentication service
 */
import { useMultiFileAuthState } from 'baileys';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class WhatsAppAuth {
  /**
   * Get auth state from file storage
   */
  static async getAuthState() {
    try {
      return await useMultiFileAuthState(config.whatsapp.authDir);
    } catch (error) {
      logger.error(`Error getting auth state: ${error}`);
      throw error;
    }
  }

  /**
   * Clear authentication files
   */
  static clearAuthState(): void {
    if (fs.existsSync(config.whatsapp.authDir)) {
      try {
        const files = fs.readdirSync(config.whatsapp.authDir);
        for (const file of files) {
          fs.unlinkSync(path.join(config.whatsapp.authDir, file));
        }
        logger.info("Authentication files cleared successfully");
      } catch (error) {
        logger.error(`Error clearing auth files: ${error}`);
      }
    }
  }

  /**
   * Create readline interface for pairing code input
   */
  static createReadLineInterface() {
    const rl = readline.createInterface({ 
      input: process.stdin, 
      output: process.stdout 
    });
    
    return {
      rl,
      question: (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
    };
  }
}
