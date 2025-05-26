/**
 * Database connection service
 */
import mongoose from 'mongoose';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class DatabaseService {
  /**
   * Connect to MongoDB
   */
  static async connect(): Promise<void> {
    try {
      await mongoose.connect(config.mongo.uri);
      logger.success('MongoDB connected successfully');
    } catch (error) {
      logger.error(`MongoDB connection error: ${error}`);
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  static async disconnect(): Promise<void> {
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    } catch (error) {
      logger.error(`MongoDB disconnect error: ${error}`);
      throw error;
    }
  }
}
