# Contributing to teguma

## Setup

```bash
git clone https://github.com/Doyajin174/teguma.git
cd teguma
npm install
```

## Development

```bash
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm test             # Run tests (Vitest)
npm run test:watch   # Watch mode
```

## Local Penpot (for integration testing)

```bash
docker compose up -d
# Wait ~30s for startup
# Create account at http://localhost:9001
# Generate MCP key: Account → Integrations → MCP Server
PENPOT_URL=http://localhost:9001 PENPOT_TOKEN=<key> npm run dev
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── server.ts             # MCP server (tool registration)
├── logger.ts             # Structured JSON logger
├── compressor.ts         # Brand context compression engine
├── penpot/
│   ├── client.ts         # Penpot HTTP RPC API client
│   └── types.ts          # Penpot data types
├── figma/
│   ├── client.ts         # Figma REST API client
│   └── converter.ts      # Figma → Penpot converter
└── tools/                # MCP tool implementations
    ├── check-connection.ts
    ├── get-design-context.ts
    ├── get-tokens.ts
    ├── get-components.ts
    ├── get-constraints.ts
    ├── get-page-layout.ts
    ├── create-element.ts
    ├── update-element.ts
    ├── delete-element.ts
    ├── import-figma.ts
    └── list-files (inline in server.ts)
```

## Commit Convention

Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, `breaking:`

## PR Process

1. Self-review (read full diff)
2. AI review (design principles, edge cases, spec alignment)
3. Fixup + squash merge

## Releasing

```bash
# Update version in package.json
npm run build
npm test
git tag v<semver>
git push origin main --tags
# CI creates GitHub Release automatically
```
