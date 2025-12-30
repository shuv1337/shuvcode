# Dev Environment LAN Access Issue

**Date:** 2025-12-30  
**Status:** Unresolved  
**Affects:** Development environment only (not production)

## Problem Summary

When accessing the Vite dev server from a LAN IP address (e.g., `http://10.0.2.100:3000/`), the web app fails to connect to the backend opencode server, even though both servers are bound to `0.0.0.0`.

## Environment

- **Vite dev server:** `bun run dev` → listening on `0.0.0.0:3000`
- **OpenCode server:** `bun run dev serve --port 4096 --hostname 0.0.0.0 --print-logs`
- **Access method:** Browser on same machine or LAN device via IP address

## Error Messages

### Original (before attempted fix):
```
Error: Could not connect to server. Is there a server running at `http://localhost:4096`?
    at bootstrap (http://10.0.2.100:3000/src/context/global-sync.tsx:317:31)
```

### After attempted fix (using `location.hostname`):
```
Error: Could not connect to server. Is there a server running at `http://10.0.2.100:4096`?
    at bootstrap (http://10.0.2.100:3000/src/context/global-sync.tsx:317:31)
```

## Analysis

### What's happening:

1. When accessing via `http://10.0.2.100:3000/`, the browser correctly loads the Vite dev server
2. The app tries to connect to the OpenCode API server
3. With original code: tries `http://localhost:4096` (wrong host from browser's perspective on LAN)
4. With fix attempt: tries `http://10.0.2.100:4096` (correct host, but still fails)

### Why the fix didn't work:

The issue is **NOT** the URL resolution logic. The URL `http://10.0.2.100:4096` is correct. The problem is one of:

1. **CORS (Cross-Origin Resource Sharing)**
   - Browser origin: `http://10.0.2.100:3000`
   - API request to: `http://10.0.2.100:4096`
   - These are different origins (different ports)
   - The OpenCode server may not be sending proper CORS headers for this origin

2. **Vite Proxy Not Being Used**
   - In dev mode, Vite is configured with a proxy to forward `/api/*` requests to the backend
   - But if the app is constructing absolute URLs like `http://10.0.2.100:4096`, it bypasses the Vite proxy entirely
   - The proxy only works for relative URLs or same-origin requests

3. **Network/Firewall**
   - Less likely since both servers are on same machine, but port 4096 could be blocked for non-localhost

## Current Server URL Resolution Logic

```typescript
const defaultServerUrl = iife(() => {
  // 1. Query parameter (highest priority)
  const param = new URLSearchParams(document.location.search).get("url")
  if (param) return param

  // 2. Known production hosts -> localhost
  if (location.hostname.includes("opencode.ai") || location.hostname.includes("shuv.ai"))
    return "http://localhost:4096"

  // 3. Desktop app (Tauri) with injected port
  if (window.__SHUVCODE__?.port) return `http://127.0.0.1:${window.__SHUVCODE__.port}`
  if (window.__OPENCODE__?.port) return `http://127.0.0.1:${window.__OPENCODE__.port}`

  // 4. Dev mode -> explicit host:port from env
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`

  // 5. Default -> same origin (production web command)
  return window.location.origin
})
```

## Potential Solutions

### Option 1: Use Vite Proxy in Dev Mode (Recommended)

Instead of returning an absolute URL in dev mode, return a relative URL so requests go through Vite's proxy:

```typescript
// 4. Dev mode -> use relative URL to go through Vite proxy
if (import.meta.env.DEV) return "/"
```

This requires the Vite proxy to be properly configured in `vite.config.ts` to forward API requests to `localhost:4096`.

**Pros:**
- Works regardless of how you access the dev server (localhost, IP, hostname)
- No CORS issues since requests are same-origin
- Already partially configured in vite.config.ts

**Cons:**
- Need to ensure all API routes are proxied
- Slightly different behavior than production

### Option 2: Configure CORS on OpenCode Server

Add CORS headers to the OpenCode server to allow requests from any origin in dev mode:

```typescript
// In packages/opencode/src/server/server.ts
if (isDev) {
  app.use('*', (c, next) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    c.header('Access-Control-Allow-Headers', '*')
    return next()
  })
}
```

**Pros:**
- Allows direct access to API from any origin
- Useful for debugging API directly

**Cons:**
- Security consideration (dev only)
- Need to modify server code

### Option 3: Environment Variable Override

Set `VITE_OPENCODE_SERVER_HOST=0.0.0.0` or the specific IP when starting dev server.

**Pros:**
- Simple, no code changes
- Explicit control

**Cons:**
- Manual configuration required
- Still has CORS issues

### Option 4: Use Same-Origin Detection (Our Previous Implementation)

Our previous (more complex) implementation had logic to detect when to use same-origin requests:

```typescript
const isLoopback = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)
const isWebCommand = !import.meta.env.DEV
const useSameOrigin = isSecure || isKnownHost || (isLoopback && !import.meta.env.DEV) || isWebCommand

if (useSameOrigin) return "/"
```

This was more complex but handled the case of non-loopback access in dev mode.

## Recommended Next Steps

1. **Verify the Vite proxy configuration** in `packages/app/vite.config.ts`
2. **Test Option 1** - Return `/` in dev mode and ensure Vite proxy forwards correctly
3. **If proxy approach doesn't work**, investigate CORS headers on the OpenCode server

## Files Involved

- `packages/app/src/app.tsx` - Server URL resolution
- `packages/app/vite.config.ts` - Vite proxy configuration
- `packages/app/src/context/global-sync.tsx` - Where the connection error originates
- `packages/opencode/src/server/server.ts` - Backend server (if CORS fix needed)

## Workaround

For now, access the dev server via `http://localhost:3000/` instead of IP address.
