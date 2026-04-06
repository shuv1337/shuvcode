# OpenPad

A mobile client for [OpenCode](https://opencode.ai) - the AI coding assistant. Built with Expo and React Native.

## Features

- Connect to any OpenCode server
- View and manage chat sessions
- Send messages and receive AI responses in real-time
- View tool usage (file reads, edits, bash commands, etc.)
- Expandable tool blocks with input/output details
- Image attachment support
- Dark/light theme support
- Live polling for real-time updates

## Screenshots

*Coming soon*

## Requirements

- Bun 1.3+
- iOS Simulator (Mac) or Android Emulator, or physical device with Expo Go

## Installation

This package is part of the shuvcode monorepo. From the repository root:

```bash
bun install
```

Start the development server:

```bash
bun run --cwd packages/mobile start
```

4. Run on your device:
   - **iOS Simulator**: Press `i` in the terminal
   - **Android Emulator**: Press `a` in the terminal
   - **Physical Device**: Scan the QR code with Expo Go app

## Connecting to OpenCode

1. Make sure you have an OpenCode server running (default: `http://localhost:9034`)
2. If running on a physical device, use your machine's local IP address instead of `localhost`
3. Enter the server URL in the connect screen and tap "Connect"

## Project Structure

```
openpad/
├── App.tsx                 # Main app entry point with navigation
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── GlassCard.tsx   # Glass morphism card component
│   │   ├── Icon.tsx        # Icon wrapper for lucide-react-native
│   │   └── Markdown.tsx    # Markdown renderer for messages
│   ├── hooks/              # Custom React hooks
│   │   ├── useOpenCode.ts  # OpenCode SDK hook (legacy)
│   │   └── useTheme.ts     # Theme hook for dark/light mode
│   ├── providers/          # Context providers
│   │   └── OpenCodeProvider.tsx  # OpenCode client & state management
│   ├── screens/            # App screens
│   │   ├── ChatScreen.tsx      # Chat conversation view
│   │   ├── ConnectScreen.tsx   # Server connection screen
│   │   ├── SessionsScreen.tsx  # Sessions list
│   │   └── SettingsScreen.tsx  # App settings
│   └── theme/              # Theme configuration
│       └── index.ts        # Colors, typography, spacing
├── assets/                 # App icons and images
└── package.json
```

## Tech Stack

- **Expo SDK 54** - React Native development platform
- **React Navigation** - Native stack navigation
- **@opencode-ai/sdk** - OpenCode API client
- **lucide-react-native** - Icon library
- **expo-blur** - Blur effects for iOS
- **react-native-markdown-display** - Markdown rendering

## Contributing

We welcome contributions! Here's how you can help:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run TypeScript check: `bun run typecheck`
5. Commit your changes: `git commit -m "feat: Add my feature"`
6. Push to your fork: `git push origin feature/my-feature`
7. Open a Pull Request

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Use functional components with hooks
- Keep components small and focused
- Use the theme system for colors and spacing

### Areas for Contribution

- UI/UX improvements
- New features (voice input, image upload, etc.)
- Performance optimizations
- Bug fixes
- Documentation improvements
- Tests

### Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/R44VC0RP/openpad/issues) with:

- Clear description of the problem or feature
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots if applicable
- Device/OS information

## License

MIT

## Acknowledgments

- [OpenCode](https://opencode.ai) - The AI coding assistant this app connects to
- [Expo](https://expo.dev) - React Native development platform
- [Lucide](https://lucide.dev) - Beautiful icons
