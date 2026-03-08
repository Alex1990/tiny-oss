# AGENTS.md - Coding Guidelines for tiny-oss

This document provides essential context and conventions for AI coding agents working on the `tiny-oss` project—a minimal browser SDK for Aliyun OSS uploads.

## Project Overview

- **Purpose:** Tiny, browser-focused Aliyun OSS SDK for uploading files. Emphasizes minimal size (<10kb gzipped) and modern browser compatibility.
- **Language:** TypeScript with strict mode enabled
- **Module System:** ES modules (ESNext)
- **Target:** ES2020, browsers with DOM support
- **Node Version:** ^20.19.0 || >=22.12.0

## Build/Lint/Test Commands

```bash
# Build the project
npm run build              # Full build (Vite + type generation)
npm run build:types        # Generate TypeScript declarations only
npm run clean              # Remove dist/ directory

# Type checking
npm run check:types        # Type check test files with tsc --noEmit

# Linting
npm run lint               # Run oxlint on src/ and test/

# Testing
npm run test               # Run vitest in watch mode
npm run test:coverage      # Run tests with coverage report
npm run test:ci            # Run tests headless (for CI): vitest run --browser.headless
npm run test:ci:coverage   # Run headless tests with coverage

# Run a single test file
npx vitest run test/index.spec.ts --browser.headless

# Run a single test case (use .only or filter)
npx vitest run --browser.headless -t "put"

# Development
npm run dev                # Start Vite dev server
npm run serve              # Start test server (required for integration tests)
```

**Important:** Tests require the test server running (`npm run serve`) as they test against real OSS endpoints via localhost:8080.

## Code Style Guidelines

### Formatting
- **Indentation:** 2 spaces (see .editorconfig)
- **Line endings:** LF
- **Charset:** UTF-8
- **Trailing whitespace:** Trimmed
- **Final newline:** Required

### Imports & Exports
- Use ES module syntax (`import`/`export`)
- Prefer named imports from utility modules
- Use default export only for main class (TinyOSS)
- Import order: external deps first, then internal utils

### Types & Naming
- Use PascalCase for classes, interfaces, types (e.g., `TinyOSS`, `PutOptions`)
- Use camelCase for variables, functions, methods (e.g., `getObjectName`)
- Use SCREAMING_SNAKE_CASE for constants
- Prefer explicit types over `any`
- Use `Record<string, any>` for flexible object parameters
- Declare namespace for related interfaces (e.g., `TinyOSS.PutOptions`)

### Error Handling
- Use try/catch for async operations
- Throw descriptive errors for invalid options
- Return rejected Promises for async failures
- Use type assertions sparingly (`as Type`)

### Code Patterns
- Prefer `async/await` over Promise chains for new code
- Use JSDoc comments for public methods with @param and @return
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Minimize external dependencies (keep bundle small)

### Browser APIs
- Use native browser APIs (XHR via custom ajax wrapper, Blob, File, DOMParser)
- Avoid Node.js-specific APIs in src/ (tests can use Node APIs)
- All core logic must be browser-compatible

### Testing
- Use Vitest with Playwright browser provider
- Tests use `describe` and `it` blocks
- Assertions use `expect().toBe()`, `expect().toHaveProperty()`, etc.
- Integration tests require test server running on :8080
- Mock server provides `/api/oss-config` and `/api/sts` endpoints

### Linting Rules
- Oxlint configuration in `oxlint.json`
- Disabled rules: `no-cond-assign`, `no-plusplus`, `no-bitwise`
- Staged files auto-fixed on commit via husky

## Key Files

- `src/TinyOSS.ts` - Main SDK class with all upload methods
- `src/utils/ajax.ts` - XHR wrapper for HTTP requests
- `src/utils/index.ts` - Utility functions (signature, MD5, etc.)
- `src/index.ts` - Entry point, exports TinyOSS
- `test/server.ts` - Test mock server (Hono-based)
- `vitest.config.ts` - Test configuration with Playwright browser

## From Copilot Instructions

- All uploads and signed URLs are compatible with Aliyun OSS REST API
- All logic is browser-native; no server-side dependencies for core SDK
- Test server uses `ali-oss` for STS token emulation in tests only
- Prefer minimal, browser-compatible solutions
- Follow patterns in `TinyOSS.ts` and `utils/`
