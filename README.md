# WhatsApp Group Member Tracker Bot

A modular WhatsApp bot built with Baileys and TypeScript for tracking members in groups containing specific keywords.

## Features

- 🔍 Automatically monitors groups with "neol" in the group name (configurable)
- 👥 Tracks all members in monitored groups
- 📊 Records when members join or leave groups
- 🔄 Maintains historical data of member status
- 📡 Simple commands to check status and force-monitor groups

## Commands

Once connected, the bot supports the following commands:

- `Hi!` - Check if the current group has the target keyword and start monitoring if so
- `sync` - Force the bot to monitor the current group regardless of its name
- `check` - Display a detailed status report of all monitored groups

## Project Structure

```
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Controllers for handling business logic
│   ├── models/          # MongoDB models
│   ├── services/        # Core services
│   │   ├── database/    # Database operations
│   │   └── whatsapp/    # WhatsApp client functionality
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   └── index.ts         # Application entry point
├── .env                 # Environment variables (create from .env.example)
└── tsconfig.json        # TypeScript configuration
```

## Installation

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd baileys-whatsapp-bot
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Configure environment:**
   ```
   cp .env.example .env
   # Edit .env file with your MongoDB connection URL and other settings
   ```

4. **Build the project:**
   ```
   npm run build
   ```

## Running the Bot

### Normal Start (Scan QR Code)
```
npm start
```

### Using Pairing Code
```
npm run start:pairing
```

### Development Mode (with auto-reload)
```
npm run dev
```

## Authentication

The bot supports two authentication methods:
- QR Code scanning (default)
- Pairing code (using `--use-pairing-code` flag)

Authentication data is stored in the `auth_info_baileys` directory and persists between sessions.

## Monitoring Logic

The bot will automatically monitor:
1. Any group with "neol" in its name
2. Any group where you send the `sync` command

## Requirements

- Node.js 16+
- MongoDB 4.4+
