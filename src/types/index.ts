/**
 * Type definitions for the application
 */
import { proto, WASocket } from 'baileys';

export interface IUser {
  phoneNumber: string;
  groupId: string;
  isActive: boolean;
  updatedAt: Date;
  createdAt?: Date;
}

export interface IGroup {
  groupId: string;
  isMonitored: boolean;
  name?: string;
  updatedAt: Date;
  createdAt?: Date;
}

export interface IDatabaseStatus {
  totalGroups: number;
  targetGroups: number;
  forceMonitoredGroups: number;
  groupDetails: Array<{
    name: string;
    id: string;
    containsTargetKeyword: boolean;
    totalMembers: number;
    activeMembers: number;
    inactiveMembers: number;
  }>;
}

export type WASocketExtended = WASocket & {
  user?: {
    id: string;
    name?: string;
  };
};

export interface WhatsappEventHandlers {
  onConnectionUpdate: (update: any) => Promise<void>;
  onCredentialsUpdate: (creds: any) => Promise<void>;
  onGroupParticipantsUpdate: (update: any) => Promise<void>;
  onGroupsUpdate: (updates: any[]) => Promise<void>;
  onGroupsUpsert: (groups: any[]) => Promise<void>;
  onMessagesUpsert: (update: { messages: proto.IWebMessageInfo[] }) => Promise<void>;
}

// Define message content type for sending messages
export type MessageContent = {
  text: string;
}
