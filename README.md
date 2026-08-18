# AurUI

A graphical package manager for Arch Linux, built with Kotlin Multiplatform and React.

![](https://img.cdn1.vip/i/6a83f3557fd5f_1787032405.webp)

## Features

- **Package Search** — Search official repos and AUR with paru
- **Install / Remove** — One-click install and remove with polkit authentication
- **System Upgrade** — Upgrade all packages via paru or pacman
- **Installed Packages** — View and filter installed packages with virtual scrolling
- **Command Logs** — Real-time command output with interactive input
- **Dark / Light Theme** — Toggle between themes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Kotlin Multiplatform (linuxX64) |
| Frontend | React 19 + Ant Design 6 + Tailwind CSS 4 |
| Build | Vite 8 (single-file HTML) + Gradle |
| IPC | WebView bridge (`window.*` functions) |

## Prerequisites

- Arch Linux (or derivative)
- [paru](https://github.com/Morganamilo/paru) (optional, for AUR support)
- Bun (for frontend build)
- JDK 17+ (for Gradle)

## Build & Run

```bash
# Debug build and run
./gradlew runDebugExecutableLinuxX64

# Or step by step
./gradlew reactBuild          # Build React frontend
./gradlew linkDebugExecutableLinuxX64  # Link native executable
./gradlew runLinuxX64         # Run
```

## Project Structure

```
AurUI/
├── src/main/kotlin/          # Kotlin backend
│   ├── Main.kt               # Entry point, WebView setup
│   ├── PacmanService.kt      # Package operations (search/install/remove/upgrade)
│   ├── CommandRunner.kt      # POSIX command execution with streaming
│   └── WebView.kt            # WebView bridge
├── src/main/react/           # React frontend
│   └── src/
│       ├── App.tsx           # All UI components (Search/Installed/Logs tabs)
│       ├── api.ts            # TanStack Query hooks + webview bridge
│       └── index.css         # Tailwind + theme variables
└── build.gradle.kts          # Gradle build with kembeddable
```

## License

MIT
