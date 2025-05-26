/**
 * MongoDB User model
 */
import mongoose from 'mongoose';
import { IUser } from '../types';

const UserSchema = new mongoose.Schema<IUser>({
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

// Create a compound index for unique users per group
UserSchema.index({ phoneNumber: 1, groupId: 1 }, { unique: true });

export const User = mongoose.model<IUser>('User', UserSchema);
