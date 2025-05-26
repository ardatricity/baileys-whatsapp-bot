/**
 * Group management service
 */
import { Group } from '../../models/Group';
import { User } from '../../models/User';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { IDatabaseStatus } from '../../types';

/**
 * Service for handling group-related operations
 */
export class GroupService {
  // In-memory cache for monitored groups
  private static monitoredGroupsCache = new Set<string>();

  /**
   * Load all monitored groups from database into memory cache
   */
  static async loadMonitoredGroups(): Promise<void> {
    try {
      const groups = await Group.find({ isMonitored: true });
      GroupService.monitoredGroupsCache = new Set(groups.map(group => group.groupId));
      logger.info(`Loaded ${GroupService.monitoredGroupsCache.size} monitored groups from database`);
    } catch (error) {
      logger.error(`Error loading monitored groups: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a group name contains the target keyword
   */
  static isTargetGroup(groupName: string): boolean {
    if (!groupName) return false;
    return groupName.toLowerCase().includes(config.whatsapp.targetKeyword);
  }

  /**
   * Check if a group is being monitored
   */
  static isMonitored(groupId: string): boolean {
    return GroupService.monitoredGroupsCache.has(groupId);
  }

  /**
   * Add a group to the monitored list
   */
  static async addGroupToMonitored(groupId: string, groupName?: string): Promise<void> {
    try {
      // Add to DB
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
      
      // Add to memory cache
      if (!GroupService.monitoredGroupsCache.has(groupId)) {
        GroupService.monitoredGroupsCache.add(groupId);
        logger.success(`Group ${groupId} added to monitored list${groupName ? ` (${groupName})` : ''}`);
      } else {
        logger.info(`Group ${groupId} already in monitored list, DB updated${groupName ? ` (${groupName})` : ''}`);
      }
    } catch (error) {
      logger.error(`Error adding group to monitored list: ${error}`);
      throw error;
    }
  }

  /**
   * Remove a group from the monitored list
   */
  static async removeGroupFromMonitored(groupId: string): Promise<void> {
    try {
      // Update DB
      await Group.findOneAndUpdate(
        { groupId },
        { isMonitored: false }
      );
      
      // Remove from memory cache
      if (GroupService.monitoredGroupsCache.has(groupId)) {
        GroupService.monitoredGroupsCache.delete(groupId);
        logger.info(`Group ${groupId} removed from monitored list`);
      }
    } catch (error) {
      logger.error(`Error removing group from monitored list: ${error}`);
      throw error;
    }
  }

  /**
   * Sync group members to MongoDB
   */
  static async syncGroupMembers(groupId: string, members: string[]): Promise<void> {
    if (!GroupService.isMonitored(groupId)) {
      logger.info(`Skipping sync for non-monitored group ${groupId}`);
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
      for (const [phoneNumber, member] of existingMembersMap.entries()) {
        if (!processedMembers.has(phoneNumber) && member.isActive) {
          await User.findByIdAndUpdate(
            member._id,
            { isActive: false, updatedAt: new Date() }
          );
        }
      }
      
      logger.success(`Synced ${members.length} members for group ${groupId}`);
    } catch (error) {
      logger.error(`Error syncing group members: ${error}`);
      throw error;
    }
  }

  /**
   * Handle members being added to a group
   */
  static async handleMembersAdded(groupId: string, members: string[]): Promise<void> {
    if (!GroupService.isMonitored(groupId)) return;
    
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
      
      logger.success(`Added ${members.length} members to group ${groupId}`);
    } catch (error) {
      logger.error(`Error adding members: ${error}`);
      throw error;
    }
  }

  /**
   * Handle members being removed from a group
   */
  static async handleMembersRemoved(groupId: string, members: string[]): Promise<void> {
    if (!GroupService.isMonitored(groupId)) return;
    
    try {
      for (const phoneNumber of members) {
        await User.findOneAndUpdate(
          { phoneNumber, groupId },
          { isActive: false, updatedAt: new Date() }
        );
      }
      
      logger.success(`Marked ${members.length} members as inactive in group ${groupId}`);
    } catch (error) {
      logger.error(`Error marking members as inactive: ${error}`);
      throw error;
    }
  }

  /**
   * Generate a full database status report
   */  static async getDatabaseStatus(): Promise<IDatabaseStatus> {
    try {
      // Get all monitored groups
      const groups = await Group.find({ isMonitored: true });
      
      let targetGroups = 0;
      let forceMonitoredGroups = 0;
      const groupDetails: Array<{
        name: string;
        id: string;
        containsTargetKeyword: boolean;
        totalMembers: number;
        activeMembers: number;
        inactiveMembers: number;
      }> = [];
      
      // For each group, get statistics
      for (const group of groups) {
        const totalMembers = await User.countDocuments({ groupId: group.groupId });
        const activeMembers = await User.countDocuments({ 
          groupId: group.groupId,
          isActive: true 
        });
        
        const containsTargetKeyword = GroupService.isTargetGroup(group.name || '');
        
        if (containsTargetKeyword) {
          targetGroups++;
        } else {
          forceMonitoredGroups++;
        }
        
        groupDetails.push({
          name: group.name || 'Unknown group name',
          id: group.groupId,
          containsTargetKeyword,
          totalMembers,
          activeMembers,
          inactiveMembers: totalMembers - activeMembers
        });
      }
      
      return {
        totalGroups: groups.length,
        targetGroups,
        forceMonitoredGroups,
        groupDetails
      };
    } catch (error) {
      logger.error(`Error generating database status: ${error}`);
      throw error;
    }
  }

  /**
   * Format database status as a readable string for messaging
   */
  static formatDatabaseStatus(status: IDatabaseStatus): string {
    let result = `📊 *Database Status*\n\n`;
    result += `Primary monitoring filter: groups with "${config.whatsapp.targetKeyword}" in their name\n`;
    result += `Total Monitored Groups: ${status.totalGroups} (${status.targetGroups} with "${config.whatsapp.targetKeyword}", ${status.forceMonitoredGroups} force-monitored)\n\n`;
    
    for (const group of status.groupDetails) {
      result += `*Group:* ${group.name}\n`;
      result += `ID: ${group.id}\n`;
      result += `Contains "${config.whatsapp.targetKeyword}": ${group.containsTargetKeyword ? '✅' : '❌'}\n`;
      result += `Total Members: ${group.totalMembers}\n`;
      result += `Active Members: ${group.activeMembers}\n`;
      result += `Inactive Members: ${group.inactiveMembers}\n\n`;
    }
    
    return result;
  }
}
