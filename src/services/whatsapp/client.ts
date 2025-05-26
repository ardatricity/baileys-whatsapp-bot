/**
 * WhatsApp client service
 */
import makeWASocket, {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  isJidGroup,
  GroupMetadata,
  proto
} from 'baileys';
import { Boom } from '@hapi/boom';
import { GroupService } from '../database/group';
import { WhatsAppAuth } from './auth';
import { logger, pinoLogger } from '../../utils/logger';
import { config } from '../../config';
import { WhatsappEventHandlers, WASocketExtended } from '../../types';

export class WhatsAppClient {
  private socket: WASocketExtended | null = null;
  private eventHandlers: WhatsappEventHandlers;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(eventHandlers: WhatsappEventHandlers) {
    this.eventHandlers = eventHandlers;
  }

  /**
   * Initialize and connect WhatsApp client
   */
  async connect(usePairingCode = false): Promise<WASocketExtended | null> {
    try {
      // Get auth state
      const { state, saveCreds } = await WhatsAppAuth.getAuthState();
      
      // Fetch latest version of WhatsApp Web
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info(`Using WhatsApp v${version.join('.')}, isLatest: ${isLatest ? 'yes' : 'no'}`);
      
      // Create WhatsApp socket connection
      this.socket = makeWASocket({
        version,
        logger: pinoLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
        },
        markOnlineOnConnect: config.whatsapp.markOnlineOnConnect
      });
      
      // Handle pairing code authentication
      if (usePairingCode && !this.socket.authState.creds.registered) {
        const { question, rl } = WhatsAppAuth.createReadLineInterface();
        const phoneNumber = await question('Please enter your phone number (with country code, e.g., 905xxxxxxxxxx):\n');
        const code = await this.socket.requestPairingCode(phoneNumber);
        logger.success(`Pairing code: ${code}`);
        rl.close();
      }
      
      // Register event listeners
      this.registerEventListeners(saveCreds);
      
      return this.socket;
    } catch (error) {
      logger.error(`Error connecting WhatsApp client: ${error}`);
      return null;
    }
  }

  /**
   * Register all event listeners
   */
  private registerEventListeners(saveCreds: (creds: any) => Promise<void>): void {
    if (!this.socket) return;
    
    // Connection events
    this.socket.ev.on('connection.update', async (update) => {
      await this.eventHandlers.onConnectionUpdate(update);
      
      // Handle reconnection logic
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        
        if (statusCode === DisconnectReason.loggedOut) {
          // User logged out - clear auth and restart
          logger.error('Connection closed. You are logged out.');
          WhatsAppAuth.clearAuthState();
          process.exit(1); // Exit and let process manager restart
        } else {
          // Temporary error - try reconnecting
          if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectAttempts * 1000, 10000);
            logger.warn(`Connection closed due to error, reconnecting (attempt ${this.reconnectAttempts})...`);
            setTimeout(() => this.connect(), delay);
          } else {
            logger.error(`Failed to reconnect after ${this.MAX_RECONNECT_ATTEMPTS} attempts.`);
            process.exit(1);
          }
        }
      } else if (connection === 'open') {
        // Connection restored
        this.reconnectAttempts = 0;
      }
    });
    
    // Save credentials when updated
    this.socket.ev.on('creds.update', saveCreds);
    
    // Group participant events
    this.socket.ev.on('group-participants.update', async (update) => {
      await this.eventHandlers.onGroupParticipantsUpdate(update);
    });
    
    // Group metadata updates
    this.socket.ev.on('groups.update', async (updates) => {
      await this.eventHandlers.onGroupsUpdate(updates);
    });
    
    // New group events
    this.socket.ev.on('groups.upsert', async (groups) => {
      await this.eventHandlers.onGroupsUpsert(groups);
    });
    
    // Message events
    this.socket.ev.on('messages.upsert', async (update) => {
      await this.eventHandlers.onMessagesUpsert(update);
    });
  }

  /**
   * Get WhatsApp socket
   */
  getSocket(): WASocketExtended | null {
    return this.socket;
  }

  /**
   * Fetch and sync all groups that match target criteria
   */
  async fetchAndMonitorTargetGroups(): Promise<void> {
    if (!this.socket) {
      logger.error('WhatsApp client not initialized');
      return;
    }
    
    try {
      // Get all participating groups
      const response = await this.socket.groupFetchAllParticipating();
      logger.info(`Fetched ${Object.keys(response).length} participating groups`);
      
      // Check each group for the target keyword
      for (const [groupId, groupInfo] of Object.entries(response)) {
        const metadata = groupInfo as GroupMetadata;
        
        if (GroupService.isTargetGroup(metadata.subject)) {
          logger.info(`Found target group: ${metadata.subject} (${groupId})`);
          
          // Add to monitored groups
          await GroupService.addGroupToMonitored(groupId as string, metadata.subject);
          
          // Sync members
          const members = metadata.participants.map(p => p.id);
          await GroupService.syncGroupMembers(groupId as string, members);
          
          logger.success(`Target group '${metadata.subject}' (${groupId}) synchronized`);
        }
      }
    } catch (error) {
      logger.error(`Error fetching and monitoring target groups: ${error}`);
    }
  }

  /**
   * Get metadata for a specific group
   */
  async getGroupMetadata(groupId: string): Promise<GroupMetadata | null> {
    if (!this.socket) {
      logger.error('WhatsApp client not initialized');
      return null;
    }
    
    try {
      return await this.socket.groupMetadata(groupId);
    } catch (error) {
      logger.error(`Error getting group metadata: ${error}`);
      return null;
    }
  }
  /**
   * Send a message to a chat
   */
  async sendMessage(to: string, content: { text: string }): Promise<proto.WebMessageInfo | undefined> {
    if (!this.socket) {
      logger.error('WhatsApp client not initialized');
      return;
    }
    
    try {
      return await this.socket.sendMessage(to, content);
    } catch (error) {
      logger.error(`Error sending message: ${error}`);
      return;
    }
  }
}
