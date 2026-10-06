// serverless multiplayer: webrtc mesh via trystero (nostr relays for signaling),
// plus a BroadcastChannel so multiple tabs on one machine see each other.
const APP_ID = 'wildhand-bensonperry-v1';
const ROOM = 'isle-1';

export class Net {
  constructor() {
    this.pid = Math.random().toString(36).slice(2, 10);
    this.handlers = {};
    this.peers = new Map(); // pid -> { last }
    this.status = 'offline';
    this.seen = new Map();
    this.seq = 0;
    this.room = null;
    this.senders = {};
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }

  emit(type, data, from) {
    for (const fn of this.handlers[type] || []) fn(data, from);
  }

  receive(msg) {
    if (!msg || msg.pid === this.pid) return;
    // drop duplicates delivered over both transports
    const last = this.seen.get(msg.pid) || 0;
    if (msg.seq <= last && msg.t !== 'hello') return;
    this.seen.set(msg.pid, msg.seq);
    if (msg.to && msg.to !== this.pid) return;
    const isNew = !this.peers.has(msg.pid);
    this.peers.set(msg.pid, { last: performance.now() });
    if (isNew) this.emit('join', msg.pid);
    this.emit(msg.t, msg.d, msg.pid);
  }

  send(t, d, to = null) {
    const msg = { pid: this.pid, seq: ++this.seq, t, d, to };
    try { this.bc?.postMessage(msg); } catch (e) { /* ignore */ }
    try { this.sendRtc?.(msg); } catch (e) { /* ignore */ }
  }

  async connect() {
    try {
      this.bc = new BroadcastChannel(`${APP_ID}:${ROOM}`);
      this.bc.onmessage = (e) => this.receive(e.data);
    } catch (e) { /* no broadcastchannel */ }
    this.status = 'local';
    try {
      const { joinRoom } = await import('../vendor/trystero-nostr.js');
      const room = joinRoom({ appId: APP_ID }, ROOM);
      this.room = room;
      const [sendMsg, getMsg] = room.makeAction('m');
      this.sendRtc = (msg) => sendMsg(msg);
      getMsg((msg) => this.receive(msg));
      room.onPeerJoin(() => { this.status = 'online'; this.emit('rtcjoin'); });
      room.onPeerLeave(() => { this.emit('rtcleave'); });
      this.status = 'online';
    } catch (e) {
      console.warn('p2p unavailable', e);
    }
    // forget silent peers
    setInterval(() => {
      const now = performance.now();
      for (const [pid, p] of this.peers) {
        if (now - p.last > 8000) { this.peers.delete(pid); this.emit('leave', pid); }
      }
    }, 2000);
  }

  get count() { return this.peers.size; }
}
