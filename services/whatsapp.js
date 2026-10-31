import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SESSIONS_DIR = path.resolve(rootDir, 'sessions', 'default');
const DATA_DIR = path.resolve(rootDir, 'data');
const HISTORY_FILE = path.resolve(DATA_DIR, 'messages.json');

export class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'QR_READY' | 'CONNECTING' | 'CONNECTED'
    this.qrCode = null; // { raw: string, dataUrl: string }
    this.pairingCode = null;
    this.pairingPhone = null;
    this.user = null; // { id: string, name: string, phone: string }
    this.socket = null;
    this.saveCreds = null;
    this.reconnectTimer = null;
    this.isReconnecting = false;
    this.messages = []; // In-memory log of recent messages

    // Active Campaign State
    this.campaign = {
      id: null,
      name: '',
      total: 0,
      sent: 0,
      failed: 0,
      isRunning: false,
      progress: 0,
      status: 'IDLE', // 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
      logs: []
    };

    this.ensureDirectories();
    this.loadMessageHistory();
  }

  ensureDirectories() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadMessageHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        this.messages = JSON.parse(raw);
      }
    } catch (err) {
      this.messages = [];
    }
  }

  saveMessageHistory() {
    try {
      // Keep last 200 messages
      if (this.messages.length > 200) {
        this.messages = this.messages.slice(-200);
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.messages, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WhatsAppService] Failed to persist message history:', err.message);
    }
  }

  logMessage(msg) {
    this.messages.unshift({
      id: msg.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      phone: msg.phone,
      direction: msg.direction || 'outgoing', // 'outgoing' | 'incoming'
      type: msg.type || 'text', // 'text' | 'image' | 'template' | 'button_reply'
      content: msg.content,
      mediaUrl: msg.mediaUrl || null,
      status: msg.status || 'SENT',
      timestamp: new Date().toISOString()
    });
    this.saveMessageHistory();
    this.emit('message_logged', this.messages[0]);
  }

  cleanPhoneNumber(raw) {
    if (!raw) return null;
    let clean = String(raw).replace(/[^0-9]/g, '');
    if (clean.length === 10) clean = '91' + clean;
    else if (clean.length === 11 && clean.startsWith('0')) clean = '91' + clean.slice(1);
    return clean;
  }

  formatJid(to) {
    const clean = this.cleanPhoneNumber(to);
    if (!clean) throw new Error('Invalid recipient phone number');
    return `${clean}@s.whatsapp.net`;
  }

  async initialize() {
    if (this.socket) {
      return;
    }

    this.ensureDirectories();
    this.status = 'CONNECTING';
    this.emit('status_change', { status: this.status });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
      this.saveCreds = saveCreds;

      const { version } = await fetchLatestBaileysVersion();
      console.log(`[WhatsAppService] Initializing with Baileys v${version.join('.')}`);

      const logger = pino({ level: 'error' });

      this.socket = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 60000
      });

      // Creds update listener
      this.socket.ev.on('creds.update', async () => {
        if (this.saveCreds) {
          await this.saveCreds();
        }
      });

      // Connection update listener
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const dataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 320,
              color: { dark: '#0f172a', light: '#ffffff' }
            });
            this.qrCode = { raw: qr, dataUrl };
            this.status = 'QR_READY';
            this.emit('qr', this.qrCode);
            this.emit('status_change', { status: this.status, qrCode: this.qrCode });
            console.log('[WhatsAppService] New QR code generated. Scan with WhatsApp!');
          } catch (qrErr) {
            console.error('[WhatsAppService] QR conversion error:', qrErr.message);
          }
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrCode = null;
          const userJid = this.socket?.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0];
          this.user = {
            id: userJid,
            name: this.socket?.user?.name || 'Business Account',
            phone: phone ? `+${phone}` : 'Connected'
          };
          this.emit('connected', this.user);
          this.emit('status_change', { status: this.status, user: this.user });
          console.log(`[WhatsAppService] 🟢 Connected successfully as ${this.user.phone}!`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsAppService] Connection closed (code: ${statusCode}, shouldReconnect: ${shouldReconnect})`);
          this.status = 'DISCONNECTED';
          this.emit('status_change', { status: this.status, statusCode });

          this.socket = null;

          if (shouldReconnect) {
            if (!this.reconnectTimer) {
              console.log('[WhatsAppService] Reconnecting in 4 seconds...');
              this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.initialize().catch(err => console.error('[WhatsAppService] Reconnect failed:', err));
              }, 4000);
            }
          } else {
            console.log('[WhatsAppService] Logged out from WhatsApp. Resetting session...');
            this.cleanSession();
            this.emit('logged_out');
          }
        }
      });

      // Incoming messages listener (for replies like "CONFIRM", "CANCEL", or inquiries)
      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.key.fromMe && msg.message) {
            const senderJid = msg.key.remoteJid;
            const senderPhone = senderJid.replace('@s.whatsapp.net', '');
            let text = '';

            if (msg.message.conversation) {
              text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
              text = msg.message.extendedTextMessage.text;
            } else if (msg.message.buttonsResponseMessage?.selectedButtonId) {
              text = `[Button]: ${msg.message.buttonsResponseMessage.selectedButtonId}`;
            } else if (msg.message.templateButtonReplyMessage?.selectedId) {
              text = `[Button]: ${msg.message.templateButtonReplyMessage.selectedId}`;
            }

            if (text) {
              console.log(`[WhatsAppService] 💬 Incoming message from +${senderPhone}: "${text}"`);
              this.logMessage({
                phone: `+${senderPhone}`,
                direction: 'incoming',
                type: 'text',
                content: text
              });
              this.emit('incoming_message', {
                from: `+${senderPhone}`,
                text,
                raw: msg
              });
            }
          }
        }
      });

    } catch (err) {
      console.error('[WhatsAppService] Initialization error:', err);
      this.status = 'DISCONNECTED';
      this.emit('status_change', { status: this.status, error: err.message });
    }
  }

  cleanSession() {
    try {
      if (fs.existsSync(SESSIONS_DIR)) {
        fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      }
      this.user = null;
      this.qrCode = null;
      this.status = 'DISCONNECTED';
      console.log('[WhatsAppService] Session credentials wiped.');
    } catch (err) {
      console.error('[WhatsAppService] Error cleaning session:', err.message);
    }
  }

  async logout() {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (err) {
        console.warn('[WhatsAppService] Logout call notice:', err.message);
      }
    }
    this.cleanSession();
    // Restart to display a new QR code immediately
    setTimeout(() => {
      this.initialize().catch(console.error);
    }, 1500);
    return { success: true, message: 'Logged out. Ready for new pairing scan.' };
  }

  async requestPairingCode(phoneNumber) {
    if (!this.socket) {
      await this.initialize();
    }
    const clean = this.cleanPhoneNumber(phoneNumber);
    if (!clean) throw new Error('Invalid phone number. Please enter a 10-digit mobile number.');

    if (this.socket?.authState?.creds?.registered) {
      throw new Error('Device is already linked/registered. Please click Unlink Device first.');
    }

    // Wait 1.5s to ensure socket connection is stable before requesting pairing code
    await new Promise(resolve => setTimeout(resolve, 1500));
    const code = await this.socket.requestPairingCode(clean);
    this.pairingCode = code;
    this.pairingPhone = clean;
    console.log(`[WhatsAppService] 🔑 Pairing code generated for ${clean}: ${code}`);
    return { success: true, code, phone: clean };
  }

  async forceRefreshQr() {
    this.cleanSession();
    if (this.socket) {
      try {
        this.socket.end(new Error('Manual refresh'));
      } catch (e) {}
      this.socket = null;
    }
    await this.initialize();
    return { success: true, message: 'QR reset triggered' };
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'CONNECTED',
      user: this.user,
      qrAvailable: !!this.qrCode,
      pairingCode: this.pairingCode,
      pairingPhone: this.pairingPhone,
      hasSession: fs.existsSync(path.join(SESSIONS_DIR, 'creds.json')),
      recentMessagesCount: this.messages.length
    };
  }

  getQr() {
    return this.qrCode;
  }

  async sendTextMessage(to, text) {
    if (this.status !== 'CONNECTED' || !this.socket) {
      throw new Error('WhatsApp is not connected. Please scan the QR code first.');
    }

    const jid = this.formatJid(to);
    const cleanPhone = this.cleanPhoneNumber(to);

    const sent = await this.socket.sendMessage(jid, { text });

    this.logMessage({
      id: sent?.key?.id,
      phone: `+${cleanPhone}`,
      direction: 'outgoing',
      type: 'text',
      content: text,
      status: 'DELIVERED'
    });

    return {
      success: true,
      messageId: sent?.key?.id,
      recipient: `+${cleanPhone}`,
      status: 'DELIVERED'
    };
  }

  async sendImageMessage(to, imageBufferOrPath, caption = '') {
    if (this.status !== 'CONNECTED' || !this.socket) {
      throw new Error('WhatsApp is not connected. Please scan the QR code first.');
    }

    const jid = this.formatJid(to);
    const cleanPhone = this.cleanPhoneNumber(to);

    let imageBuffer;
    if (Buffer.isBuffer(imageBufferOrPath)) {
      imageBuffer = imageBufferOrPath;
    } else if (typeof imageBufferOrPath === 'string' && fs.existsSync(imageBufferOrPath)) {
      imageBuffer = fs.readFileSync(imageBufferOrPath);
    } else {
      throw new Error('Invalid image file or buffer provided');
    }

    const sent = await this.socket.sendMessage(jid, {
      image: imageBuffer,
      caption: caption || ''
    });

    this.logMessage({
      id: sent?.key?.id,
      phone: `+${cleanPhone}`,
      direction: 'outgoing',
      type: 'image',
      content: caption || '[Photo]',
      status: 'DELIVERED'
    });

    return {
      success: true,
      messageId: sent?.key?.id,
      recipient: `+${cleanPhone}`,
      status: 'DELIVERED'
    };
  }

  // --- E-COMMERCE SPECIFIC HELPERS (GoWhats Style) ---

  async sendCodVerification({ phone, customerName, orderId, amount, address, storeName = 'Paps Stationery Store' }) {
    const message = 
`📦 *${storeName.toUpperCase()} - COD ORDER VERIFICATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hi *${customerName}*! Thank you for ordering with us.

🛒 *Order ID:* #${orderId}
💵 *COD Total Amount:* ₹${amount}
📍 *Delivery Address:* 
${address}

To prevent order delays, please confirm your delivery:
👉 Reply *CONFIRM* to ship your order immediately.
👉 Reply *CANCEL* if you placed this by mistake.

_(Our team will dispatch as soon as you reply CONFIRM)_`;

    return await this.sendTextMessage(phone, message);
  }

  async sendOrderReceipt({ phone, customerName, orderId, items = [], total, trackingUrl, storeName = 'Paps Stationery Store' }) {
    const itemsList = items.map(i => `• ${i.name} (x${i.qty || 1}) - ₹${i.price * (i.qty || 1)}`).join('\n');
    const message = 
`🎉 *ORDER CONFIRMED - ${storeName.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hi *${customerName}*, your order #${orderId} has been confirmed!

*Items Ordered:*
${itemsList || '• Stationery Pack'}

💰 *Total Paid:* ₹${total}
🚚 *Tracking & Details:* ${trackingUrl || 'https://papsstore.com/orders/' + orderId}

Thank you for shopping with us! ✨`;

    return await this.sendTextMessage(phone, message);
  }

  async sendAbandonedCart({ phone, customerName, itemsSummary, checkoutLink, discountCode = 'EXTRA10', storeName = 'Paps Stationery Store' }) {
    const message = 
`👀 *Did you leave something behind at ${storeName}?*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hey *${customerName}*, we noticed you didn't finish checking out your cart:

🛍️ *Items:* ${itemsSummary || 'Selected items'}

We reserved your cart for 2 hours! Use code *${discountCode}* to get an extra 10% OFF right now:
👉 *Complete Purchase:* ${checkoutLink}

Need help? Reply to this message and our team will assist you! ✨`;

    return await this.sendTextMessage(phone, message);
  }

  // --- SAFE BROADCAST & CAMPAIGN ENGINE (Anti-Ban Pacing) ---

  async startBroadcast({ name, contacts, template, mediaPath, minDelaySec = 20, maxDelaySec = 40 }) {
    if (this.campaign.isRunning) {
      throw new Error('A campaign is already running. Please wait or cancel the active one.');
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      throw new Error('Contacts array cannot be empty');
    }

    this.campaign = {
      id: 'camp_' + Date.now(),
      name: name || 'Festive Broadcast',
      total: contacts.length,
      sent: 0,
      failed: 0,
      isRunning: true,
      progress: 0,
      status: 'RUNNING',
      logs: []
    };

    console.log(`[CampaignEngine] Starting campaign "${this.campaign.name}" for ${contacts.length} recipients...`);

    // Run asynchronously in background
    (async () => {
      for (let i = 0; i < contacts.length; i++) {
        if (!this.campaign.isRunning) {
          console.log('[CampaignEngine] Campaign paused or cancelled.');
          break;
        }

        const contact = contacts[i];
        try {
          // Parse dynamic template variables
          let personalizedText = template
            .replace(/\{\{name\}\}/gi, contact.name || 'Friend')
            .replace(/\{\{phone\}\}/gi, contact.phone || '')
            .replace(/\{\{link\}\}/gi, contact.link || '')
            .replace(/\{\{discount\}\}/gi, contact.discount || '15% OFF')
            .replace(/\{\{order_id\}\}/gi, contact.order_id || '');

          if (mediaPath && fs.existsSync(mediaPath)) {
            await this.sendImageMessage(contact.phone, mediaPath, personalizedText);
          } else {
            await this.sendTextMessage(contact.phone, personalizedText);
          }

          this.campaign.sent++;
          this.campaign.logs.unshift({
            phone: contact.phone,
            name: contact.name,
            status: 'SUCCESS',
            time: new Date().toLocaleTimeString()
          });
        } catch (err) {
          this.campaign.failed++;
          this.campaign.logs.unshift({
            phone: contact.phone,
            name: contact.name,
            status: 'FAILED',
            error: err.message,
            time: new Date().toLocaleTimeString()
          });
          console.error(`[CampaignEngine] Failed sending to ${contact.phone}:`, err.message);
        }

        this.campaign.progress = Math.round(((i + 1) / contacts.length) * 100);
        this.emit('campaign_progress', this.campaign);

        // Anti-ban jitter delay between messages (if more contacts remain)
        if (i < contacts.length - 1 && this.campaign.isRunning) {
          const delayMs = Math.floor(
            (minDelaySec + Math.random() * (maxDelaySec - minDelaySec)) * 1000
          );
          console.log(`[CampaignEngine] Pacing delay: ${(delayMs / 1000).toFixed(1)}s before next message...`);
          await new Promise(res => setTimeout(res, delayMs));
        }
      }

      this.campaign.isRunning = false;
      this.campaign.status = 'COMPLETED';
      this.emit('campaign_completed', this.campaign);
      console.log(`[CampaignEngine] Campaign "${this.campaign.name}" finished! Sent: ${this.campaign.sent}, Failed: ${this.campaign.failed}`);
    })().catch(err => {
      console.error('[CampaignEngine] Critical error in campaign runner:', err);
      this.campaign.isRunning = false;
      this.campaign.status = 'FAILED';
    });

    return {
      success: true,
      campaignId: this.campaign.id,
      totalContacts: contacts.length,
      estimatedMinutes: Math.round((contacts.length * ((minDelaySec + maxDelaySec) / 2)) / 60)
    };
  }

  cancelBroadcast() {
    if (this.campaign.isRunning) {
      this.campaign.isRunning = false;
      this.campaign.status = 'CANCELLED';
      return { success: true, message: 'Campaign cancelled.' };
    }
    return { success: false, message: 'No active campaign running.' };
  }
}

export const whatsappService = new WhatsAppService();
