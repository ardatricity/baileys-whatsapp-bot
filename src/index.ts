/**
 * WhatsApp Bot for Group Member Tracking
 * Main application entry point
 */
import { DatabaseService } from './services/database/connection';
import { GroupService } from './services/database/group';
import { WhatsAppController } from './controllers/whatsapp';
import { logger } from './utils/logger';

/**
 * Main application class
 */
class Application {
  private whatsAppController: WhatsAppController;
  
  constructor() {
    this.whatsAppController = new WhatsAppController();
  }
  
  /**
   * Initialize and start the application
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting WhatsApp Bot...');
      
      // Connect to MongoDB
      await DatabaseService.connect();
      
      // Load monitored groups
      await GroupService.loadMonitoredGroups();
      
      // Determine if using pairing code
      const usePairingCode = process.argv.includes('--use-pairing-code');
      
      // Start WhatsApp client
      await this.whatsAppController.start(usePairingCode);
      
    } catch (error) {
      logger.error(`Application startup error: ${error}`);
      process.exit(1);
    }
  }
}

// Create and start application
const app = new Application();

// Start with error handling
app.start().catch(error => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
