const net = require('net');
const { encode, decode } = require('@msgpack/msgpack');
const EventEmitter = require('events');

/**
 * Production-Ready TCP Socket Module
 * API mimics Socket.IO with automatic reconnection, heartbeats, and message queuing
 */
class TCPSocket extends EventEmitter {
  constructor(options = {}) {
    super();
    
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
  }

  // ========== PUBLIC API ==========

  /**
   * Connect to server
   */
  connect(host, port) {
    if (this.connected || this.connecting) return Promise.resolve();
    
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
          
          this.emit('connect');
          resolve();
        });

        this.socket.on('data', (chunk) => {
          this.handleData(chunk);
        });

        this.socket.on('error', (err) => {
          this.log('Socket error:', err.message);
          this.emit('error', err);
          
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
        this.once('connect', () => clearTimeout(timeout));

      } catch (err) {
        this.connecting = false;
        reject(err);
      }
    });
  }

  /**
   * Emit event (like socket.emit)
   */
  emit(event, data, callback) {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a string');
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
        this.ackCallbacks.set(message.id, {
          callback: callback || resolve,
          timeout: setTimeout(() => {
            this.ackCallbacks.delete(message.id);
            reject(new Error(`Ack timeout for event: ${event}`));
          }, this.options.messageTimeout)
        });
      }

      this.send(message);
      
      if (!callback) resolve();
    });
  }

  /**
   * Listen to event (like socket.on)
   */
  on(event, handler) {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a string');
    }
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

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
   * Disconnect (like socket.disconnect)
   */
  disconnect() {
    this.closed = true;
    this.ready = false;
    this.connected = false;
    this.connecting = false;
    
    this.stopHeartbeat();
    this.clearReconnectTimer();
    
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    
    this.buffer = Buffer.alloc(0);
    this.messageQueue = [];
    this.ackCallbacks.clear();
    
    this.emit('disconnect');
  }

  // ========== INTERNAL METHODS ==========

  send(message) {
    if (!this.connected || !this.socket) {
      // Queue message for later
      this.messageQueue.push(message);
      return;
    }

    try {
      const encoded = encode(message);
      const length = Buffer.alloc(4);
      length.writeUInt32LE(encoded.length, 0);
      
      this.socket.write(Buffer.concat([length, encoded]));
      this.log('Sent:', message.event || 'ack');
    } catch (err) {
      this.log('Send error:', err.message);
      this.emit('error', err);
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
        this.emit('error', err);
      }
    }
  }

  handleMessage(message) {
    if (!message.type) return;

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
        this.emit('error', new Error(message.data));
        break;
    }
  }

  handleEvent(message) {
    const { event, data, id, ack } = message;
    
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const results = [];
      
      for (const handler of handlers) {
        try {
          const result = handler(data);
          results.push(result);
        } catch (err) {
          this.log(`Handler error for ${event}:`, err.message);
          this.emit('error', err);
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
    } else if (event === 'ping') {
      // Special ping event for latency testing
      this.emit('ping', data);
      this.send({
        type: 'ack',
        id: id,
        data: { pong: Date.now() }
      });
    }
  }

  handleAck(message) {
    if (this.ackCallbacks.has(message.id)) {
      const ack = this.ackCallbacks.get(message.id);
      clearTimeout(ack.timeout);
      this.ackCallbacks.delete(message.id);
      
      if (typeof ack.callback === 'function') {
        ack.callback(message.data);
      }
    }
  }

  handleHeartbeat(message) {
    // Respond to heartbeat
    if (message.type === 'heartbeat') {
      this.send({
        type: 'heartbeat',
        data: { pong: Date.now() }
      });
      this.emit('heartbeat');
    }
    
    // Reset heartbeat timer on pong
    if (message.data && message.data.pong) {
      this.emit('heartbeat');
    }
  }

  handleDisconnect() {
    this.connected = false;
    this.ready = false;
    this.connecting = false;
    
    this.stopHeartbeat();
    
    this.emit('disconnect');
    
    // Auto-reconnect
    if (this.options.reconnect && !this.closed) {
      this.scheduleReconnect();
    }
  }

  // ========== HEARTBEAT ==========

  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      
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
      this.emit('reconnect_failed');
      return;
    }
    
    const delay = this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().then(() => {
        this.emit('reconnect', this.reconnectAttempts);
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
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  // ========== UTILITY ==========

  log(...args) {
    if (this.options.debug) {
      console.log('[TCPSocket]', ...args);
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
      connected: this.connected,
      ready: this.ready,
      closed: this.closed,
      reconnectAttempts: this.reconnectAttempts,
      queueLength: this.messageQueue.length,
      ackCount: this.ackCallbacks.size,
      eventCount: this.eventHandlers.size,
      bufferSize: this.buffer.length
    };
  }
}

// ========== SERVER SIDE ==========

class TCPServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      port: options.port || 3000,
      host: options.host || '0.0.0.0',
      heartbeatInterval: options.heartbeatInterval || 30000,
      debug: options.debug || false,
      ...options
    };
    
    this.server = null;
    this.clients = new Map();
    this.clientId = 0;
  }

  /**
   * Start server
   */
  listen(port, host) {
    return new Promise((resolve, reject) => {
      try {
        this.server = net.createServer((socket) => {
          this.handleConnection(socket);
        });

        const listenPort = port || this.options.port;
        const listenHost = host || this.options.host;

        this.server.listen(listenPort, listenHost, () => {
          this.log('Server listening on', `${listenHost}:${listenPort}`);
          this.emit('listening');
          resolve();
        });

        this.server.on('error', (err) => {
          this.log('Server error:', err.message);
          this.emit('error', err);
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
      debug: this.options.debug
    });
    
    client.socket = socket;
    client.connected = true;
    client.ready = true;
    client.id = clientId;
    
    // Override socket handlers
    socket.on('data', (chunk) => client.handleData(chunk));
    socket.on('error', (err) => client.emit('error', err));
    socket.on('close', () => {
      client.connected = false;
      client.ready = false;
      this.clients.delete(clientId);
      client.emit('disconnect');
      this.emit('client_disconnect', client);
    });
    
    // Add client methods
    client.emit = function(event, data, callback) {
      const message = {
        type: 'event',
        event: event,
        data: data !== undefined ? data : null,
        ack: !!callback,
        id: client.ackId++
      };
      
      if (callback) {
        client.ackCallbacks.set(message.id, {
          callback: callback,
          timeout: setTimeout(() => {
            client.ackCallbacks.delete(message.id);
          }, client.options.messageTimeout)
        });
      }
      
      client.send(message);
      return this;
    };
    
    // Send connect event to client
    client.send({
      type: 'event',
      event: 'connect',
      data: { clientId }
    });
    
    // Store client
    this.clients.set(clientId, client);
    this.emit('client_connect', client);
    this.emit('connection', client);
    
    this.log('Client connected:', clientId);
  }

  /**
   * Broadcast to all clients
   */
  broadcast(event, data) {
    for (const [id, client] of this.clients) {
      if (client.connected) {
        client.emit(event, data);
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
   * Close server
   */
  close() {
    return new Promise((resolve) => {
      if (this.server) {
        // Disconnect all clients
        for (const [id, client] of this.clients) {
          client.disconnect();
        }
        this.clients.clear();
        
        this.server.close(() => {
          this.log('Server closed');
          this.emit('close');
          resolve();
        });
      } else {
        resolve();
      }
    });
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