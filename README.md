# River Journal


Private stream-of-consciousness journaling, across all your devices.

Local-first, universally cross-platform.

Built with Next.js, Expo, Tauri, and Tamagui.

## 🏗️ Architecture

This is a monorepo supporting multiple platforms:

- **Web**: Next.js application (`apps/web/`)
- **Mobile**: Expo React Native application (`apps/mobile/`)
- **Desktop**: Tauri application (`apps/desktop/`)
- **Shared UI**: Tamagui components (`packages/ui/`)
- **Shared Logic**: Core application logic (`packages/app/`)

## 🚀 Quick Start

### Prerequisites

- Node.js 22+
- Yarn 4.5+
- For mobile development: Expo CLI, iOS Simulator, Android Studio
- For desktop development: Rust and Tauri CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/CharlesCoeder/river-journal.git
cd river-journal

# Install dependencies
yarn install

# Build shared packages
yarn build
```

## 📱 Platform-Specific Commands

### Web Development

```bash
# Start development server
yarn web

# Build for production
yarn web:prod

# Serve production build
yarn web:prod:serve
```

### Mobile Development

```bash
# Start Expo development server
yarn mobile

# Run on iOS simulator
yarn ios

# Run on Android emulator/device
yarn android

# Prebuild native projects
yarn mobile:prebuild
```

### Desktop Development

```bash
# Start desktop development
yarn desktop

# Build desktop application
yarn desktop:build
```

## 🧪 Testing & Quality

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run linting
yarn lint

# Check Tamagui configuration
yarn check-tamagui
```

## 🛠️ Development

### Project Structure

```
river-journal/
├── apps/
│   ├── web/          # Next.js web app
│   ├── mobile/       # Expo mobile app
│   └── desktop/      # Tauri desktop app
└── packages/
    ├── ui/           # Shared Tamagui components
    ├── app/          # Shared application logic
    └── config/       # Shared configuration
```

### Key Technologies

- **Frontend**: Next.js 15, Expo SDK 53
- **UI Library**: Tamagui for cross-platform components
- **State Management**: Legend-State v3 with persistence/optional sync
- **Package Manager**: Yarn with workspaces
- **TypeScript**: with strict mode

### State Management & Persistence

- **Web**: IndexedDB via Legend-State
- **Mobile**: MMKV via Legend-State
- **Desktop**: Tauri IndexedDB via Legend-State


**Build Errors**

- Ensure all dependencies are installed: `yarn install`
- Rebuild shared packages: `yarn build`

**Mobile Development**

- iOS: Ensure Xcode and iOS Simulator are installed
- Android: Ensure Android Studio and emulator are set up
- Run `yarn mobile:prebuild` if native dependencies change

**Desktop Development**

- Ensure Rust is installed: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs/ | sh`