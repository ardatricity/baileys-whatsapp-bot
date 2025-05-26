/**
 * WhatsApp event handlers
 */
import { Boom } from '@hapi/boom';
import { DisconnectReason, GroupMetadata, isJidGroup } from 'baileys';
import qrcode from 'qrcode-terminal';
import { GroupService } from '../services/database/group';
import { WhatsAppAuth } from '../services/whatsapp/auth';
import { WhatsAppClient } from '../services/whatsapp/client';
import { logger } from '../utils/logger';
import { WhatsappEventHandlers } from '../types';

export class WhatsAppController {
  private client: WhatsAppClient;
  
  constructor() {
    // Create event handlers
    const eventHandlers: WhatsappEventHandlers = {
      onConnectionUpdate: this.handleConnectionUpdate.bind(this),
      onCredentialsUpdate: this.handleCredentialsUpdate.bind(this),
      onGroupParticipantsUpdate: this.handleGroupParticipantsUpdate.bind(this),
      onGroupsUpdate: this.handleGroupsUpdate.bind(this),
      onGroupsUpsert: this.handleGroupsUpsert.bind(this),
      onMessagesUpsert: this.handleMessagesUpsert.bind(this)
    };
    
    // Initialize WhatsApp client with event handlers
    this.client = new WhatsAppClient(eventHandlers);
  }

  /**
   * Start WhatsApp client
   */
  async start(usePairingCode: boolean = false): Promise<void> {
    try {
      await this.client.connect(usePairingCode);
    } catch (error) {
      logger.error(`Error starting WhatsApp client: ${error}`);
      throw error;
    }
  }

  /**
   * Handle connection update events
   */
  async handleConnectionUpdate(update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      logger.info('QR Code received. Scan it with your phone.');
      // Generate QR code in terminal
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'open') {
      logger.success('Connection established! Bot is ready.');
      
      // Display bot info
      const socket = this.client.getSocket();
      if (socket?.user) {
        logger.info(`Bot connected as: ${socket.user.name || 'Unknown'} (${socket.user.id.split('@')[0]})`);
      }

      // Fetch and monitor all groups with target keyword in their name
      logger.info('Scanning for target groups...');
      await this.client.fetchAndMonitorTargetGroups();
    }
  }

  /**
   * Handle credentials update events
   */
  async handleCredentialsUpdate(creds: any): Promise<void> {
    // This is handled by the WhatsAppClient class
  }

  /**
   * Handle group participants update events
   */
  async handleGroupParticipantsUpdate(update: any): Promise<void> {
    const { id: groupId, participants, action } = update;
    
    // Skip if group is not in monitored list
    if (!GroupService.isMonitored(groupId)) {
      // We will check if this is a target group that should be monitored
      try {
        const metadata = await this.client.getGroupMetadata(groupId);
        if (!metadata) return;
        
        const groupName = metadata.subject;
        
        if (GroupService.isTargetGroup(groupName)) {
          logger.info(`Detected activity in unmonitored target group: ${groupName} (${groupId})`);
          
          // Add it to monitored groups
          await GroupService.addGroupToMonitored(groupId, groupName);
          
          // Sync all members
          const members = metadata.participants.map(p => p.id);
          await GroupService.syncGroupMembers(groupId, members);
          
          logger.success(`Group '${groupName}' (${groupId}) is now monitored`);
          
          // Continue processing the current update after adding to monitored list
          if (action === 'add') {
            await GroupService.handleMembersAdded(groupId, participants);
          } else if (action === 'remove') {
            await GroupService.handleMembersRemoved(groupId, participants);
          }
        } else {
          logger.info(`Skipping unmonitored group without target keyword: ${groupName}`);
        }
      } catch (error) {
        logger.error(`Error checking unmonitored group: ${error}`);
      }
      return;
    }
    
    // Process the update for monitored groups
    logger.info(`Group ${groupId} participants ${action}: ${participants.join(', ')}`);
    
    if (action === 'add') {
      await GroupService.handleMembersAdded(groupId, participants);
    } else if (action === 'remove') {
      await GroupService.handleMembersRemoved(groupId, participants);
    } else if (action === 'promote' || action === 'demote') {
      // For admin changes, we don't need to update anything in our current schema
    }
  }

  /**
   * Handle group update events
   */
  async handleGroupsUpdate(updates: any[]): Promise<void> {
    for (const update of updates) {
      if (!update.id) continue;
      
      // Skip if not monitored and doesn't contain target keyword
      if (GroupService.isMonitored(update.id)) {
        logger.info(`Group ${update.id} updated: ${JSON.stringify(update)}`); 
      }
      
      // If subject (group name) is updated
      if (update.subject) {
        const newGroupName = update.subject;
        const isTargetGroup = GroupService.isTargetGroup(newGroupName);
        
        // If the group is already monitored
        if (GroupService.isMonitored(update.id)) {
          // Update the name in database
          await GroupService.addGroupToMonitored(update.id, newGroupName);
          logger.info(`Updated monitored group name to: ${newGroupName}`);
          
          // Check if it still contains the target keyword
          if (!isTargetGroup) {
            logger.warn(`Group ${update.id} renamed to '${newGroupName}' which doesn't match target criteria anymore`);
            // We keep monitoring it for now, but log a warning
          }
        } 
        // If the group is not monitored but now contains target keyword
        else if (isTargetGroup) {
          logger.info(`Unmonitored group updated with target name: ${newGroupName} (${update.id})`);
          
          // Get full metadata to get members
          try {
            const metadata = await this.client.getGroupMetadata(update.id);
            if (!metadata) continue;
            
            // Add to monitored groups with the new name
            await GroupService.addGroupToMonitored(update.id, newGroupName);
            
            // Sync members
            const members = metadata.participants.map(p => p.id);
            await GroupService.syncGroupMembers(update.id, members);
            
            logger.success(`Group '${newGroupName}' (${update.id}) is now monitored and synchronized`);
          } catch (error) {
            logger.error(`Error adding newly named target group: ${error}`);
          }
        }
      }
    }
  }

  /**
   * Handle groups upsert events (when added to a new group)
   */
  async handleGroupsUpsert(groups: any[]): Promise<void> {
    for (const group of groups) {
      logger.info(`Added to new group: ${group.id} - ${group.subject}`);
      
      // Check if group name contains the target keyword
      if (GroupService.isTargetGroup(group.subject)) {
        logger.info(`Found new target group: ${group.subject} (${group.id})`);
        
        // Add to monitored groups
        await GroupService.addGroupToMonitored(group.id, group.subject);
          // Sync members if available
        if (group.participants && group.participants.length > 0) {
          const members = group.participants.map((p: any) => p.id);
          await GroupService.syncGroupMembers(group.id, members);
          logger.success(`New target group '${group.subject}' (${group.id}) synchronized`);
        }
      } else {
        logger.info(`Group ${group.subject} does not match target criteria, skipping`);
      }
    }
  }

  /**
   * Handle messages upsert events
   */
  async handleMessagesUpsert(update: { messages: any[] }): Promise<void> {
    for (const message of update.messages) {
      // Skip if there's no actual message content
      if (!message.message) continue;
      
      const jid = message.key.remoteJid;
      if (!jid) continue;
      
      const isGroup = isJidGroup(jid);
      const fromMe = message.key.fromMe;
      
      // Extract message text
      const messageText = message.message.conversation || 
        message.message.extendedTextMessage?.text || '';
      
      // If message is from me and says 'Hi!', add that group to monitored list
      if (fromMe && messageText === 'Hi!' && isGroup) {
        logger.info(`Detected 'Hi!' in group ${jid}`);
        await this.handleHiCommand(jid);
      }
      
      // If message is from me and says 'sync', force monitor that group regardless of name
      if (fromMe && messageText === 'sync' && isGroup) {
        logger.info(`Detected 'sync' in group ${jid}`);
        await this.handleSyncCommand(jid);
      }
      
      // If message is from me and says 'check', print database status
      if (fromMe && messageText === 'check') {
        logger.info('Detected check command');
        await this.handleCheckCommand(jid);
      }
    }
  }

  /**
   * Handle 'Hi!' command
   */
  private async handleHiCommand(jid: string): Promise<void> {
    try {
      // Get group metadata
      const metadata = await this.client.getGroupMetadata(jid);
      if (!metadata) return;
      
      const groupName = metadata.subject;
      logger.info(`Group metadata retrieved: ${groupName} (${jid})`);
      
      // Check if group name contains the target keyword
      if (GroupService.isTargetGroup(groupName)) {
        logger.info(`Group name '${groupName}' contains target keyword`);
        
        // Add to monitored groups
        await GroupService.addGroupToMonitored(jid, groupName);
        
        // Sync members
        const members = metadata.participants.map(p => p.id);
        logger.info(`Syncing ${members.length} members for group ${jid}`);
        await GroupService.syncGroupMembers(jid, members);
        
        // Confirm action
        logger.success(`Group '${groupName}' (${jid}) fully synchronized`);
      } else {
        logger.info(`Group '${groupName}' does not match target criteria, skipping`);
      }
    } catch (error) {
      logger.error(`Error processing 'Hi!' command: ${error}`);
    }
  }

  /**
   * Handle 'sync' command
   */
  private async handleSyncCommand(jid: string): Promise<void> {
    try {
      // Get group metadata
      const metadata = await this.client.getGroupMetadata(jid);
      if (!metadata) return;
      
      const groupName = metadata.subject;
      logger.info(`Group metadata retrieved: ${groupName} (${jid})`);
      
      // Add to monitored groups regardless of name
      await GroupService.addGroupToMonitored(jid, groupName);
      
      // Sync members
      const members = metadata.participants.map(p => p.id);
      logger.info(`Syncing ${members.length} members for group ${jid}`);
      await GroupService.syncGroupMembers(jid, members);
      
      // Confirm action
      logger.success(`Group '${groupName}' (${jid}) force-monitored and fully synchronized`);
      
      // Send a confirmation message to the group
      //await this.client.sendMessage(jid, { text: `✅ This group is now being monitored.` });
    } catch (error) {
      logger.error(`Error processing 'sync' command: ${error}`);
    }
  }

  /**
   * Handle 'check' command
   */
  private async handleCheckCommand(jid: string): Promise<void> {
    try {
      const status = await GroupService.getDatabaseStatus();
      const formattedStatus = GroupService.formatDatabaseStatus(status);
      
      logger.info(formattedStatus); // Log to console
      
      // If this was sent in a chat, also send the status as a reply
      if (jid) {
        await this.client.sendMessage(jid, { text: formattedStatus });
      }
    } catch (error) {
      logger.error(`Error processing 'check' command: ${error}`);
    }
  }
}
