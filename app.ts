/**
 * Clean WhatsApp Bot for Group Member Tracking
 * Captures members of specified groups and stores them in MongoDB
 */

import { Boom } from '@hapi/boom';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  proto,
  delay,
  WAMessageKey,
  GroupMetadata,
} from 'baileys';
import mongoose from 'mongoose';
import pino from 'pino';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Constants
const AUTH_DIR = './auth_info_baileys';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp-bot';

// Initialize logger
const logger = pino({ level: 'warn' }).child({ module: 'bot' });
const console_logger = {
  info: (message: string) => console.log(`\x1b[34m[INFO]\x1b[0m ${message}`),
  warn: (message: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${message}`),
  error: (message: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`),
  success: (message: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`)
};

// -----------------------------------------------------------------------------
// MongoDB Models & Connection
// -----------------------------------------------------------------------------

// User Schema
const UserSchema = new mongoose.Schema({
  phoneNumber: { 
    type: String, 
    required: true,
    index: true 
  },
  groupId: { 
    type: String, 
    required: true,
    index: true
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

UserSchema.index({ phoneNumber: 1, groupId: 1 }, { unique: true });
const User = mongoose.model('User', UserSchema);

// Group Schema
const GroupSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  isMonitored: {
    type: Boolean,
    default: true
  },
  name: String,
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

const Group = mongoose.model('Group', GroupSchema);

// Connect to MongoDB
async function connectToMongoDB(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI);
    console_logger.success("MongoDB connected successfully");
  } catch (error) {
    console_logger.error(`MongoDB connection error: ${error}`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Group Operations
// -----------------------------------------------------------------------------

// In-memory cache for monitored groups
let monitoredGroups = new Set<string>();

// Check if a group name contains the target keyword ("neol")
function isTargetGroup(groupName: string): boolean {
  return groupName.toLowerCase().includes('neol');
}

// Fetch and monitor all participating groups with "neol" in their name
async function fetchAndMonitorTargetGroups(sock: any): Promise<void> {
  try {
    // Get all participating groups
    const response = await sock.groupFetchAllParticipating();
    console_logger.info(`Fetched ${Object.keys(response).length} participating groups`);
    
    // Check each group for the target keyword
    for (const [groupId, groupInfo] of Object.entries(response)) {
      const metadata = groupInfo as GroupMetadata;
      
      if (isTargetGroup(metadata.subject)) {
        console_logger.info(`Found target group: ${metadata.subject} (${groupId})`);
        
        // Add to monitored groups
        await addGroupToMonitored(groupId as string, metadata.subject);
        
        // Sync members
        const members = metadata.participants.map(p => p.id);
        await syncGroupMembers(groupId as string, members);
        
        console_logger.success(`Target group '${metadata.subject}' (${groupId}) synchronized`);
      }
    }
  } catch (error) {
    console_logger.error(`Error fetching and monitoring target groups: ${error}`);
  }
}

// Load monitored groups from MongoDB
async function loadMonitoredGroups(): Promise<void> {
  try {
    const groups = await Group.find({ isMonitored: true });
    monitoredGroups = new Set(groups.map(group => group.groupId));
    console_logger.info(`Loaded ${monitoredGroups.size} monitored groups from database`);
  } catch (error) {
    console_logger.error(`Error loading monitored groups: ${error}`);
  }
}

// Add a group to monitored list
async function addGroupToMonitored(groupId: string, groupName?: string): Promise<void> {
  try {
    // Add to DB (always)
    await Group.findOneAndUpdate(
      { groupId },
      { 
        groupId, 
        isMonitored: true, 
        name: groupName,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    // Add to memory if not already there
    if (!monitoredGroups.has(groupId)) {
      monitoredGroups.add(groupId);
      console_logger.success(`Group ${groupId} added to monitored list${groupName ? ` (${groupName})` : ''}`);
    } else {
      console_logger.info(`Group ${groupId} already in monitored list, DB updated${groupName ? ` (${groupName})` : ''}`);
    }
  } catch (error) {
    console_logger.error(`Error adding group to monitored list: ${error}`);
  }
}

// Sync group members to MongoDB
async function syncGroupMembers(groupId: string, members: string[]): Promise<void> {
  if (!monitoredGroups.has(groupId)) {
    console_logger.info(`Skipping sync for non-monitored group ${groupId}`);
    return;
  }

  try {
    // Get existing members from DB
    const existingMembers = await User.find({ groupId });
    const existingMembersMap = new Map(existingMembers.map(member => [member.phoneNumber, member]));
    
    // Track which members we've processed
    const processedMembers = new Set<string>();
    
    // Update or create members
    for (const phoneNumber of members) {
      processedMembers.add(phoneNumber);
      
      await User.findOneAndUpdate(
        { phoneNumber, groupId },
        { 
          phoneNumber,
          groupId,
          isActive: true,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
    }
    
    // Mark members not in the current list as inactive
    for (const [phoneNumber, member] of existingMembersMap) {
      if (!processedMembers.has(phoneNumber) && member.isActive) {
        await User.findByIdAndUpdate(
          member._id,
          { isActive: false, updatedAt: new Date() }
        );
      }
    }
    
    console_logger.success(`Synced ${members.length} members for group ${groupId}`);
  } catch (error) {
    console_logger.error(`Error syncing group members: ${error}`);
  }
}

// Handle member additions to a group
async function handleMembersAdded(groupId: string, members: string[]): Promise<void> {
  if (!monitoredGroups.has(groupId)) return;
  
  try {
    for (const phoneNumber of members) {
      await User.findOneAndUpdate(
        { phoneNumber, groupId },
        {
          phoneNumber,
          groupId,
          isActive: true,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
    }
    
    console_logger.success(`Added ${members.length} members to group ${groupId}`);
  } catch (error) {
    console_logger.error(`Error adding members: ${error}`);
  }
}

// Handle member removals from a group
async function handleMembersRemoved(groupId: string, members: string[]): Promise<void> {
  if (!monitoredGroups.has(groupId)) return;
  
  try {
    for (const phoneNumber of members) {
      await User.findOneAndUpdate(
        { phoneNumber, groupId },
        { isActive: false, updatedAt: new Date() }
      );
    }
    
    console_logger.success(`Marked ${members.length} members as inactive in group ${groupId}`);
  } catch (error) {
    console_logger.error(`Error marking members as inactive: ${error}`);
  }
}

// Print database status
async function printDatabaseStatus(): Promise<string> {
  try {
    // Get all groups
    const groups = await Group.find({ isMonitored: true });
    
    let result = `📊 *Database Status*\n\n`;
    result += `Primary monitoring filter: groups with "neol" in their name\n`;
    result += `Total Monitored Groups: ${groups.length}\n\n`;
    
    let neolGroups = 0;
    let forceSyncedGroups = 0;
    
    // For each group, get statistics
    for (const group of groups) {
      const totalMembers = await User.countDocuments({ groupId: group.groupId });
      const activeMembers = await User.countDocuments({ groupId: group.groupId, isActive: true });
      const hasNeol = isTargetGroup(group.name || '');
      
      if (hasNeol) {
        neolGroups++;
      } else {
        forceSyncedGroups++;
      }
      
      result += `*Group:* ${group.name || group.groupId}\n`;
      result += `ID: ${group.groupId}\n`;
      result += `Contains "neol": ${hasNeol ? '✅' : '❌'}\n`;
      result += `Total Members: ${totalMembers}\n`;
      result += `Active Members: ${activeMembers}\n`;
      result += `Inactive Members: ${totalMembers - activeMembers}\n\n`;
    }
    
    // Add summary
    result = result.replace('Total Monitored Groups', 
      `Total Monitored Groups: ${groups.length} (${neolGroups} with "neol", ${forceSyncedGroups} force-monitored)`);
    
    return result;
  } catch (error) {
    console_logger.error(`Error generating database status: ${error}`);
    return `Error generating database status: ${error}`;
  }
}

// -----------------------------------------------------------------------------
// Auth Management
// -----------------------------------------------------------------------------

// Clear auth files
function clearAuthState(): void {
  if (fs.existsSync(AUTH_DIR)) {
    try {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(AUTH_DIR, file));
      }
      console_logger.info("Authentication files cleared successfully");
    } catch (error) {
      console_logger.error(`Error clearing auth files: ${error}`);
    }
  }
}

// Read line interface for pairing code input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve));

// -----------------------------------------------------------------------------
// Main Bot Logic
// -----------------------------------------------------------------------------

// Main bot function
async function startBot() {
  try {
    // Connect to MongoDB
    await connectToMongoDB();
    
    // Load monitored groups
    await loadMonitoredGroups();
    
    // Auth state management - persists session data
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    // Fetch latest version of WhatsApp Web
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console_logger.info(`Using WhatsApp v${version.join('.')}, isLatest: ${isLatest ? 'yes' : 'no'}`);
    
    // Determine if using pairing code
    const usePairingCode = process.argv.includes('--use-pairing-code');
    
    // Create WhatsApp socket connection
    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: !usePairingCode,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      markOnlineOnConnect: false, // set to false to receive notifications on phone
    });
    
    // Handle pairing code authentication
    if (usePairingCode && !sock.authState.creds.registered) {
      const phoneNumber = await question('Please enter your phone number (with country code, e.g., 905xxxxxxxxxx):\n');
      const code = await sock.requestPairingCode(phoneNumber);
      console_logger.success(`Pairing code: ${code}`);
    }
    
    // -------------------------------------------------------------------------
    // Event Handlers
    // -------------------------------------------------------------------------
    
    // Handle participant changes in groups
    sock.ev.on('group-participants.update', async (update) => {
      const { id: groupId, participants, action } = update;
      
      // Skip if group is not in monitored list
      if (!monitoredGroups.has(groupId)) {
        // We will check if this is a "neol" group that should be monitored
        try {
          const metadata = await sock.groupMetadata(groupId);
          const groupName = metadata.subject;
          
          if (isTargetGroup(groupName)) {
            console_logger.info(`Detected activity in unmonitored target group: ${groupName} (${groupId})`);
            
            // Add it to monitored groups
            await addGroupToMonitored(groupId, groupName);
            
            // Sync all members
            const members = metadata.participants.map(p => p.id);
            await syncGroupMembers(groupId, members);
            
            console_logger.success(`Group '${groupName}' (${groupId}) is now monitored`);
            
            // Continue processing the current update after adding to monitored list
            if (action === 'add') {
              await handleMembersAdded(groupId, participants);
            } else if (action === 'remove') {
              await handleMembersRemoved(groupId, participants);
            }
          } else {
            console_logger.info(`Skipping unmonitored group without target keyword: ${groupName}`);
          }
        } catch (error) {
          console_logger.error(`Error checking unmonitored group: ${error}`);
        }
        return;
      }
      
      // Process the update for monitored groups
      console_logger.info(`Group ${groupId} participants ${action}: ${participants.join(', ')}`);
      
      if (action === 'add') {
        await handleMembersAdded(groupId, participants);
      } else if (action === 'remove') {
        await handleMembersRemoved(groupId, participants);
      } else if (action === 'promote' || action === 'demote') {
        // For admin changes, we don't need to update anything in our current schema
      }
    });
    
    // Handle group metadata updates
    sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        
        // Skip if not monitored and doesn't contain target keyword
        if (monitoredGroups.has(update.id)) {
          console_logger.info(`Group ${update.id} updated: ${JSON.stringify(update)}`); 
        }
        
        // If subject (group name) is updated
        if (update.subject) {
          const newGroupName = update.subject;
          const isNeolGroup = isTargetGroup(newGroupName);
          
          // If the group is already monitored
          if (monitoredGroups.has(update.id)) {
            // Update the name in database
            await Group.findOneAndUpdate(
              { groupId: update.id },
              { name: newGroupName, updatedAt: new Date() }
            );
            console_logger.info(`Updated monitored group name to: ${newGroupName}`);
            
            // Check if it still contains the target keyword
            if (!isNeolGroup) {
              console_logger.warn(`Group ${update.id} renamed to '${newGroupName}' which doesn't match target criteria anymore`);
              // We keep monitoring it for now, but log a warning
            }
          } 
          // If the group is not monitored but now contains "neol"
          else if (isNeolGroup) {
            console_logger.info(`Unmonitored group updated with target name: ${newGroupName} (${update.id})`);
            
            // Get full metadata to get members
            try {
              const metadata = await sock.groupMetadata(update.id);
              
              // Add to monitored groups with the new name
              await addGroupToMonitored(update.id, newGroupName);
              
              // Sync members
              const members = metadata.participants.map(p => p.id);
              await syncGroupMembers(update.id, members);
              
              console_logger.success(`Group '${newGroupName}' (${update.id}) is now monitored and synchronized`);
            } catch (error) {
              console_logger.error(`Error adding newly named neol group: ${error}`);
            }
          }
        }
      }
    });
    
    // Handle when we're added to a group
    sock.ev.on('groups.upsert', async (groups) => {
      for (const group of groups) {
        console_logger.info(`Added to new group: ${group.id} - ${group.subject}`);
        
        // Check if group name contains the target keyword
        if (isTargetGroup(group.subject)) {
          console_logger.info(`Found new target group: ${group.subject} (${group.id})`);
          
          // Add to monitored groups
          await addGroupToMonitored(group.id, group.subject);
          
          // Sync members if available
          if (group.participants && group.participants.length > 0) {
            const members = group.participants.map(p => p.id);
            await syncGroupMembers(group.id, members);
            console_logger.success(`New target group '${group.subject}' (${group.id}) synchronized`);
          }
        } else {
          console_logger.info(`Group ${group.subject} does not match target criteria, skipping`);
        }
      }
    });
    
    // Handle messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
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
          console_logger.info(`Detected 'Hi!' in group ${jid}`);
          
          try {
            // Get group metadata
            const metadata = await sock.groupMetadata(jid);
            const groupName = metadata.subject;
            console_logger.info(`Group metadata retrieved: ${groupName} (${jid})`);
            
            // Check if group name contains the target keyword
            if (isTargetGroup(groupName)) {
              console_logger.info(`Group name '${groupName}' contains target keyword`);
              
              // Add to monitored groups
              await addGroupToMonitored(jid, groupName);
              
              // Sync members
              const members = metadata.participants.map(p => p.id);
              console_logger.info(`Syncing ${members.length} members for group ${jid}`);
              await syncGroupMembers(jid, members);
              
              // Confirm action
              console_logger.success(`Group '${groupName}' (${jid}) fully synchronized`);
            } else {
              console_logger.info(`Group '${groupName}' does not match target criteria, skipping`);
            }
          } catch (error) {
            console_logger.error(`Error processing 'Hi!' command: ${error}`);
          }
        }
        
        // If message is from me and says 'sync', force monitor that group regardless of name
        if (fromMe && messageText === 'sync' && isGroup) {
          console_logger.info(`Detected 'sync' in group ${jid}`);
          
          try {
            // Get group metadata
            const metadata = await sock.groupMetadata(jid);
            const groupName = metadata.subject;
            console_logger.info(`Group metadata retrieved: ${groupName} (${jid})`);
            
            // Add to monitored groups regardless of name
            await addGroupToMonitored(jid, groupName);
            
            // Sync members
            const members = metadata.participants.map(p => p.id);
            console_logger.info(`Syncing ${members.length} members for group ${jid}`);
            await syncGroupMembers(jid, members);
            
            // Confirm action
            console_logger.success(`Group '${groupName}' (${jid}) force-monitored and fully synchronized`);
            
            // Send a confirmation message to the group
            //await sock.sendMessage(jid, { text: `✅ This group is now being monitored.` });
          } catch (error) {
            console_logger.error(`Error processing 'sync' command: ${error}`);
          }
        }
        
        // If message is from me and says 'check', print database status
        if (fromMe && messageText === 'check') {
          console_logger.info('Detected check command');
          
          const status = await printDatabaseStatus();
          console_logger.info(status); // Log to console

        }
      }
    });
    
    // Handle connection events
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console_logger.info('QR Code received. Scan it with your phone.');
      }
      
      if (connection === 'close') {
        // Check if we should reconnect
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        
        if (statusCode !== DisconnectReason.loggedOut) {
          console_logger.warn('Connection closed due to error, reconnecting...');
          setTimeout(() => startBot(), 5000);
        } else {
          console_logger.error('Connection closed. You are logged out.');
          // Clear auth files when logged out
          clearAuthState();
          // Restart the bot to get a new auth
          console_logger.info('Restarting bot to get a new authentication...');
          setTimeout(() => startBot(), 3000);
        }
      }
      
      if (connection === 'open') {
        console_logger.success('Connection established! Bot is ready.');
        
        // Display bot info
        if (sock.user) {
          console_logger.info(`Bot connected as: ${sock.user.name || 'Unknown'} (${sock.user.id.split('@')[0]})`);
        }

        // Fetch and monitor all groups with "neol" in their name
        console_logger.info('Scanning for target groups...');
        await fetchAndMonitorTargetGroups(sock);
      }
    });
    
    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);
    
  } catch (error) {
    console_logger.error(`Startup error: ${error}`);
    console_logger.warn('Retrying in 10 seconds...');
    setTimeout(() => startBot(), 10000);
  }
}

// Start the bot with error handling
console_logger.info('Starting WhatsApp Bot...');
startBot().catch(err => {
  console_logger.error(`Fatal error: ${err}`);
  process.exit(1);
}); 