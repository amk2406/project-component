# 🔌 TCP Socket
A zero-dependency, Socket.IO-like TCP module for Node.js — production-ready, small, and fast. Provides named events, auto-reconnect, heartbeats, message queuing, acknowledgments, binary support, and robust error handling.

[![Node >=14](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)]()

---

## Table of Contents

- [Overview](#overview)  
- [Highlights](#highlights)  
- [Installation](#installation)  
- [Quick Start](#quick-start)  
  - [Server](#server)  
  - [Client](#client)  
- [API](#api)  
  - [TCPSocket (Client)](#tcp-socket-client)  
  - [TCPServer (Server)](#tcp-server-server)  
- [Advanced Usage](#advanced-usage)  
- [Error Handling & Best Practices](#error-handling--best-practices)  
- [Testing](#testing)  
- [Contributing](#contributing)  
- [License & Support](#license--support)  

---

## Overview

TCP Socket provides a lightweight, dependable TCP communication layer with a familiar Socket.IO-style API. It's designed for applications that need low-latency, real-time communication over raw TCP with conveniences typically found in higher-level libraries.

Why use this module?

- Socket.IO-like API — events, acknowledgments, rooms, and broadcasting.
- Reliable connection management — automatic reconnection, heartbeat monitoring.
- Message queuing and resume on reconnect.
- Full Buffer/binary support via MessagePack.
- Zero runtime dependencies — only Node.js built-ins and optional @msgpack/msgpack for efficient binary serialization.
- Tiny code size, high performance.

---

## Highlights

- emit/on/once/off API surface
- Automatic reconnection with exponential backoff
- Heartbeats & connection health detection
- Message queueing with durable delivery attempts
- Acknowledgments (callbacks + Promise-based)
- Binary-safe (Buffers) with MessagePack support
- Optional room-based broadcasting
- Debug mode and comprehensive error events

---

## Installation

This module uses MessagePack for binary payloads. Install the serializer:

```bash
npm install @msgpack/msgpack
```

To use the module, copy `tcp-socket.js` into your project (recommended for local use):

```bash
cp tcp-socket.js ./lib/
```

Requirements:

- Node.js >= 14
- Platform: Linux, macOS, Windows

---

## Quick Start

### Server

```javascript
const { createServer } = require('./tcp-socket');

(async () => {
  const server = createServer({
    port: 3000,
    debug: true,
    heartbeatInterval: 30000
  });

  server.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    socket.on('message', (data) => {
      console.log(`📩 ${data.user}: ${data.text}`);

      // Respond
      socket.emit('response', { status: 'received', timestamp: Date.now() });

      // Broadcast
      server.broadcast('broadcast', { user: data.user, message: data.text });
    });

    socket.on('disconnect', () => {
      console.log(`❌ Client ${socket.id} disconnected`);
    });
  });

  await server.listen(3000);
  console.log('🚀 Server running on port 3000');
})();
```

### Client

```javascript
const { createSocket } = require('./tcp-socket');

(async () => {
  const client = createSocket({
    host: 'localhost',
    port: 3000,
    reconnect: true,
    maxReconnectAttempts: 10,
    debug: true
  });

  await client.connect();

  client.on('response', (data) => {
    console.log('📥 Server response:', data);
  });

  client.on('broadcast', (data) => {
    console.log(`📢 Broadcast from ${data.user}: ${data.message}`);
  });

  // Emit with Promise-based ack
  await client.emit('message', { user: 'Alice', text: 'Hello everyone!' });

  // Emit with callback ack
  await client.emit('message', { user: 'Alice', text: 'Hello with ack!' }, (ack) => {
    console.log('✅ Message delivered:', ack);
  });

  // client.disconnect();
})();
```

---

## API

### TCPSocket (Client)

new TCPSocket(options)

Options
- port (number) — default: 3000
- host (string) — default: 'localhost'
- reconnect (boolean) — default: true
- reconnectInterval (number) — default: 2000 (ms)
- maxReconnectAttempts (number) — default: 10
- heartbeatInterval (number) — default: 30000 (ms)
- heartbeatTimeout (number) — default: 10000 (ms)
- messageTimeout (number) — default: 30000 (ms)
- debug (boolean) — default: false

Methods
- connect([host, port]) — Promise
- emit(event, data, [callback]) — Promise if no callback
- on(event, handler) — register listener
- once(event, handler) — one-time listener
- off(event, [handler]) — remove handler(s)
- disconnect() — graceful disconnect
- isConnected() — boolean
- getStats() — connection metrics object

Example ack-based emit:

```javascript
const ack = await socket.emit('fetch', { id: 123 });
```

### TCPServer (Server)

new TCPServer(options)

Methods
- listen([port, host]) — Promise
- broadcast(event, data) — emit to all clients
- getClients() — returns clients array
- close() — closes server and clients (Promise)

---

## Advanced Usage

Rooms (example extension):

```javascript
class ChatServer extends TCPServer {
  constructor(options) {
    super(options);
    this.rooms = new Map();
  }

  joinRoom(clientId, room) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(clientId);
  }

  broadcastToRoom(room, event, data) {
    const clients = this.rooms.get(room);
    if (!clients) return;
    for (const id of clients) {
      const client = this.clients.get(id);
      if (client?.isConnected()) client.emit(event, data);
    }
  }
}
```

File transfer with chunked uploads, progress events, compression, and streaming support are demonstrated in the examples folder.

---

## Error Handling & Best Practices

- Listen for `error`, `reconnect`, `disconnect`, and `reconnect_failed`.
- Validate incoming data and sanitize before processing.
- Queue critical messages on disconnect and persist to disk if necessary.
- Use binary (MessagePack) for large payloads and Buffer support for raw files.
- Avoid sending unbounded arrays/objects; enforce size limits and rate limits.

Example global error handler:

```javascript
client.on('error', (err) => {
  console.error('Socket error:', err.message);
  if (err.code === 'ECONNREFUSED') { /* ... */ }
  else if (err.message.includes('heartbeat')) { /* ... */ }
});
```

Safe emit helper:

```javascript
function safeEmit(socket, event, data) {
  if (!socket.isConnected()) {
    // queue or persist
    return Promise.reject(new Error('Not connected'));
  }
  return socket.emit(event, data);
}
```

---

## Testing

Unit tests use mocha/describe style. Example snippet:

```javascript
const { createSocket, createServer } = require('./tcp-socket');
const assert = require('assert');

describe('TCPSocket', () => {
  let server, client;
  before(async () => {
    server = createServer({ port: 3000, debug: false });
    await server.listen(3000);
  });
  beforeEach(async () => { client = createSocket({ port: 3000 }); await client.connect(); });
  afterEach(() => client.disconnect());
  after(async () => await server.close());

  it('should send and receive events', (done) => {
    client.on('test', (data) => {
      assert.strictEqual(data.message, 'Hello');
      done();
    });
    client.emit('test', { message: 'Hello' });
  });
});
```

Run tests:

```bash
npm test
npm run test:coverage
```

---

## Contributing

We welcome contributions!

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature`
3. Implement changes & add tests
4. Run tests and linting
5. Open a pull request with a clear description

Guidelines: keep commits atomic, document changes, and include tests for behavior changes.

---

## License & Support

Licensed under the MIT License. See LICENSE for details.

For issues or discussion:
- Issues: https://github.com/amk2406/project-component/issues
- Discussions: https://github.com/amk2406/project-component/discussions
- Email: abdulamk2406@gmail.com

---

Thank you for using TCP Socket — built with ❤️ for the Node.js community.
