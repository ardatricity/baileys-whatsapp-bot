/**
 * MongoDB Group model
 */
import mongoose from 'mongoose';
import { IGroup } from '../types';

const GroupSchema = new mongoose.Schema<IGroup>({
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

export const Group = mongoose.model<IGroup>('Group', GroupSchema);
