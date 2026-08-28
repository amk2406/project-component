// tcp-socket-fixed.js
const net = require('net');
const { encode, decode } = require('@msgpack/msgpack');
const EventEmitter = require('events');

/**
 * Production-Ready TCP Socket Module
 * Fixed: No recursion, proper event handling, memory leak prevention
 */
class TCPSocket {
  constructor(options = {}) {
    // Use internal event emitter instead of extending
    this._events = new EventEmitter();
    
    // Configuration
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      reconnect: options.reconnect !== false,
      reconnectInterval: options.reconnectInterval || 2000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      heartbeatInterval: options.heartbeatInterval || 30000,
      heartbeatTimeout: options.heartbeatTimeout || 10000,
      messageTimeout: options.messageTimeout || 30000,
      debug: options.debug || false,
      ...options
    };

    // State
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatTimeoutTimer = null;
    this.buffer = Buffer.alloc(0);
    this.messageQueue = [];
    this.eventHandlers = new Map();
    this.ackCallbacks = new Map();
    this.ackId = 0;
    this.ready = false;
    this.closed = false;
    this._id = options.id || Date.now().toString(36);
  }

  // ========== PUBLIC API ==========

  /**
   * Connect to server
   */
  async connect(host, port) {
    if (this.connected || this.connecting) {
      this.log('Already connecting or connected');
      return;
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.connecting = true;
        this.closed = false;
        
        const connectHost = host || this.options.host;
        const connectPort = port || this.options.port;
        
        this.log('Connecting to', `${connectHost}:${connectPort}`);
        
        this.socket = net.createConnection({ 
          host: connectHost, 
          port: connectPort 
        });

        // Setup socket events
        this.socket.on('connect', () => {
          this.connected = true;
          this.connecting = false;
          this.reconnectAttempts = 0;
          this.ready = true;
          
          this.log('Connected successfully');
          
          // Start heartbeat
          this.startHeartbeat();
          
          // Send queued messages
          this.flushQueue();
          
          // Emit connect event using internal emitter
          this._events.emit('connect');
          resolve();
        });

        this.socket.on('data', (chunk) => {
          this.handleData(chunk);
        });

        this.socket.on('error', (err) => {
          this.log('Socket error:', err.message);
          this._events.emit('error', err);
          
          if (this.connecting) {
            reject(err);
          }
        });

        this.socket.on('close', () => {
          this.handleDisconnect();
        });

        // Timeout if connection takes too long
        const timeout = setTimeout(() => {
          if (!this.connected && this.connecting) {
            this.socket.destroy();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        // Clear timeout on connect
        this._events.once('connect', () => clearTimeout(timeout));

      } catch (err) {
        this.connecting = false;
        reject(err);
      }
    });
  }

  /**
   * Emit event (like socket.emit)
   * FIXED: No recursion with EventEmitter
   */
  emit(event, data, callback) {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a string');
    }

    // Check if this is a reserved event (should use internal emitter)
    if (['connect', 'disconnect', 'error', 'reconnect', 'reconnect_failed'].includes(event)) {
      throw new Error(`Cannot emit reserved event: ${event}`);
    }

    return new Promise((resolve, reject) => {
      const message = {
        type: 'event',
        event: event,
        data: data !== undefined ? data : null,
        ack: !!callback || false,
        id: this.ackId++
      };

      // Store ack callback if provided
      if (callback || message.ack) {
        const timeoutId = setTimeout(() => {
          this.ackCallbacks.delete(message.id);
          reject(new Error(`Ack timeout for event: ${event}`));
        }, this.options.messageTimeout);
        
        this.ackCallbacks.set(message.id, {
          callback: callback || resolve,
          timeout: timeoutId,
          event: event
        });
      }

      this.send(message);
      
      if (!callback) resolve();
    });
  }

  /**
   * Listen to event (like socket.on)
   * FIXED: Uses internal EventEmitter
   */
  on(event, handler) {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a string');
    }
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    // For internal events, use EventEmitter
    if (['connect', 'disconnect', 'error', 'reconnect', 'reconnect_failed', 'heartbeat'].includes(event)) {
      this._events.on(event, handler);
      return this;
    }

    // For custom events, store in map
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
    
    return this;
  }

  /**
   * Listen once (like socket.once)
   */
  once(event, handler) {
    if (['connect', 'disconnect', 'error', 'reconnect', 'reconnect_failed', 'heartbeat'].includes(event)) {
      this._events.once(event, handler);
      return this;
    }

    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove listener (like socket.off)
   */
  off(event, handler) {
    if (!event) {
      this.eventHandlers.clear();
      this._events.removeAllListeners();
      return this;
    }

    // For internal events
    if (['connect', 'disconnect', 'error', 'reconnect', 'reconnect_failed', 'heartbeat'].includes(event)) {
      if (handler) {
        this._events.off(event, handler);
      } else {
        this._events.removeAllListeners(event);
      }
      return this;
    }

    if (!handler) {
      this.eventHandlers.delete(event);
      return this;
    }

    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
      if (handlers.length === 0) this.eventHandlers.delete(event);
    }

    return this;
  }

  /**
   * Listen to all events (like socket.onAny)
   * NEW: Added for debugging
   */
  onAny(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this._events.on('any', handler);
    return this;
  }

  offAny(handler) {
    if (handler) {
      this._events.off('any', handler);
    } else {
      this._events.removeAllListeners('any');
    }
    return this;
  }

  /**
   * Disconnect (like socket.disconnect)
   */
  disconnect() {
    this.closed = true;
    this.ready = false;
    this.connected = false;
    this.connecting = false;
    
    this.stopHeartbeat();
    this.clearReconnectTimer();
    
    // Clear all ack callbacks to prevent memory leaks
    for (const [id, ack] of this.ackCallbacks) {
      clearTimeout(ack.timeout);
    }
    this.ackCallbacks.clear();
    
    // Clear message queue
    this.messageQueue = [];
    
    if (this.socket) {
      // Remove all listeners to prevent memory leaks
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    
    this.buffer = Buffer.alloc(0);
    
    this._events.emit('disconnect');
  }

  // ========== INTERNAL METHODS ==========

  send(message) {
    if (!this.connected || !this.socket || this.socket.destroyed) {
      // Queue message for later
      this.messageQueue.push(message);
      this.log('Queued message:', message.event || 'ack');
      return;
    }

    try {
      const encoded = encode(message);
      const length = Buffer.alloc(4);
      length.writeUInt32LE(encoded.length, 0);
      
      // Check if socket is writable
      if (!this.socket.writable) {
        this.messageQueue.push(message);
        this.log('Socket not writable, queuing message');
        return;
      }
      
      this.socket.write(Buffer.concat([length, encoded]));
      this.log('Sent:', message.event || 'ack');
    } catch (err) {
      this.log('Send error:', err.message);
      this._events.emit('error', err);
      // Queue for retry
      this.messageQueue.push(message);
    }
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32LE(0);
      
      if (this.buffer.length < 4 + msgLen) break;
      
      const data = this.buffer.slice(4, 4 + msgLen);
      this.buffer = this.buffer.slice(4 + msgLen);
      
      try {
        const message = decode(data);
        this.handleMessage(message);
      } catch (err) {
        this.log('Parse error:', err.message);
        this._events.emit('error', err);
      }
    }
  }

  handleMessage(message) {
    if (!message || !message.type) {
      this.log('Invalid message received');
      return;
    }

    // Emit any event for debugging
    this._events.emit('any', message);

    switch (message.type) {
      case 'event':
        this.handleEvent(message);
        break;
        
      case 'ack':
        this.handleAck(message);
        break;
        
      case 'heartbeat':
        this.handleHeartbeat(message);
        break;
        
      case 'error':
        this._events.emit('error', new Error(message.data));
        break;
        
      default:
        this.log('Unknown message type:', message.type);
    }
  }

  handleEvent(message) {
    const { event, data, id, ack } = message;
    
    // Emit internal event
    this._events.emit('any_event', event, data);
    
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const results = [];
      
      for (const handler of handlers) {
        try {
          const result = handler(data);
          results.push(result);
        } catch (err) {
          this.log(`Handler error for ${event}:`, err.message);
          this._events.emit('error', err);
        }
      }
      
      // Send acknowledgment if requested
      if (ack) {
        this.send({
          type: 'ack',
          id: id,
          data: results.length === 1 ? results[0] : results
        });
      }
    } else {
      // No handler, send error acknowledgment if ack requested
      if (ack) {
        this.send({
          type: 'ack',
          id: id,
          data: { error: `No handler for event: ${event}` }
        });
      }
    }
  }

  handleAck(message) {
    if (this.ackCallbacks.has(message.id)) {
      const ack = this.ackCallbacks.get(message.id);
      clearTimeout(ack.timeout);
      this.ackCallbacks.delete(message.id);
      
      if (typeof ack.callback === 'function') {
        try {
          ack.callback(message.data);
        } catch (err) {
          this.log('Ack callback error:', err.message);
          this._events.emit('error', err);
        }
      }
    }
  }

  handleHeartbeat(message) {
    // Respond to heartbeat
    if (message.data && message.data.ping) {
      this.send({
        type: 'heartbeat',
        data: { pong: Date.now(), ping: message.data.ping }
      });
    }
    
    // Reset heartbeat timer on pong
    if (message.data && message.data.pong) {
      this._events.emit('heartbeat');
    }
  }

  handleDisconnect() {
    const wasConnected = this.connected;
    this.connected = false;
    this.ready = false;
    this.connecting = false;
    
    this.stopHeartbeat();
    
    // Clear pending acks
    for (const [id, ack] of this.ackCallbacks) {
      clearTimeout(ack.timeout);
    }
    this.ackCallbacks.clear();
    
    this._events.emit('disconnect');
    
    // Auto-reconnect
    if (this.options.reconnect && !this.closed && wasConnected) {
      this.scheduleReconnect();
    }
  }

  // ========== HEARTBEAT ==========

  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.socket || this.socket.destroyed) {
        return;
      }
      
      // Send heartbeat
      this.send({
        type: 'heartbeat',
        data: { ping: Date.now() }
      });
      
      // Set timeout for heartbeat response
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.log('Heartbeat timeout, reconnecting...');
        this.handleDisconnect();
      }, this.options.heartbeatTimeout);
      
    }, this.options.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  // ========== RECONNECTION ==========

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.options.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      this._events.emit('reconnect_failed');
      return;
    }
    
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().then(() => {
        this._events.emit('reconnect', this.reconnectAttempts);
      }).catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ========== QUEUE MANAGEMENT ==========

  flushQueue() {
    while (this.messageQueue.length > 0 && this.connected && this.socket && this.socket.writable) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  // ========== UTILITY ==========

  log(...args) {
    if (this.options.debug) {
      console.log(`[TCPSocket ${this._id}]`, ...args);
    }
  }

  /**
   * Check connection status
   */
  isConnected() {
    return this.connected && this.socket && !this.socket.destroyed;
  }

  /**
   * Get socket stats
   */
  getStats() {
    return {
      id: this._id,
      connected: this.connected,
      ready: this.ready,
      closed: this.closed,
      reconnectAttempts: this.reconnectAttempts,
      queueLength: this.messageQueue.length,
      ackCount: this.ackCallbacks.size,
      eventCount: this.eventHandlers.size,
      bufferSize: this.buffer.length,
      options: {
        host: this.options.host,
        port: this.options.port,
        reconnect: this.options.reconnect,
        maxReconnectAttempts: this.options.maxReconnectAttempts
      }
    };
  }

  /**
   * Get client ID
   */
  get id() {
    return this._id;
  }
}

// ========== SERVER SIDE (Fixed) ==========

class TCPServer {
  constructor(options = {}) {
    this.options = {
      port: options.port || 3000,
      host: options.host || '0.0.0.0',
      heartbeatInterval: options.heartbeatInterval || 30000,
      debug: options.debug || false,
      ...options
    };
    
    this.server = null;
    this.clients = new Map();
    this._events = new EventEmitter();
    this.clientId = 0;
  }

  /**
   * Start server
   */
  async listen(port, host) {
    return new Promise((resolve, reject) => {
      try {
        this.server = net.createServer((socket) => {
          this.handleConnection(socket);
        });

        const listenPort = port || this.options.port;
        const listenHost = host || this.options.host;

        this.server.listen(listenPort, listenHost, () => {
          this.log('Server listening on', `${listenHost}:${listenPort}`);
          this._events.emit('listening');
          resolve();
        });

        this.server.on('error', (err) => {
          this.log('Server error:', err.message);
          this._events.emit('error', err);
          reject(err);
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  handleConnection(socket) {
    const clientId = ++this.clientId;
    const client = new TCPSocket({
      ...this.options,
      reconnect: false,
      debug: this.options.debug,
      id: `client-${clientId}`
    });
    
    // Replace socket with the connected one
    client.socket = socket;
    client.connected = true;
    client.ready = true;
    client._id = `client-${clientId}`;
    
    // Override socket handlers
    socket.on('data', (chunk) => client.handleData(chunk));
    socket.on('error', (err) => {
      client._events.emit('error', err);
    });
    socket.on('close', () => {
      client.connected = false;
      client.ready = false;
      client.closed = true;
      this.clients.delete(clientId);
      client._events.emit('disconnect');
      this._events.emit('client_disconnect', client);
    });
    
    // Store client
    this.clients.set(clientId, client);
    this._events.emit('client_connect', client);
    this._events.emit('connection', client);
    
    // Send connect event to client
    client.send({
      type: 'event',
      event: 'connect',
      data: { clientId }
    });
    
    this.log('Client connected:', clientId);
  }

  /**
   * Broadcast to all clients
   */
  broadcast(event, data) {
    for (const [id, client] of this.clients) {
      if (client.connected && client.socket && !client.socket.destroyed) {
        client.emit(event, data).catch(err => {
          this.log(`Broadcast error to client ${id}:`, err.message);
        });
      }
    }
  }

  /**
   * Get all connected clients
   */
  getClients() {
    return Array.from(this.clients.values()).filter(c => c.connected);
  }

  /**
   * Get client by ID
   */
  getClient(id) {
    return this.clients.get(id);
  }

  /**
   * Close server
   */
  async close() {
    return new Promise((resolve) => {
      if (this.server) {
        // Disconnect all clients
        for (const [id, client] of this.clients) {
          client.disconnect();
        }
        this.clients.clear();
        
        this.server.close(() => {
          this.log('Server closed');
          this._events.emit('close');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Event handlers
  on(event, handler) {
    this._events.on(event, handler);
    return this;
  }

  once(event, handler) {
    this._events.once(event, handler);
    return this;
  }

  off(event, handler) {
    if (handler) {
      this._events.off(event, handler);
    } else {
      this._events.removeAllListeners(event);
    }
    return this;
  }

  log(...args) {
    if (this.options.debug) {
      console.log('[TCPServer]', ...args);
    }
  }
}

// ========== EXPORTS ==========

module.exports = {
  TCPSocket,
  TCPServer,
  createSocket: (options) => new TCPSocket(options),
  createServer: (options) => new TCPServer(options)
};