import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { whatsappService } from '../services/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `media_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

const router = express.Router();

// Helper to parse contacts from plain text (e.g. "9791356364, Tamil Kavi" or Excel copy-paste)
function parseContactsText(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  return lines.map(raw => {
    const phoneMatch = raw.match(/(?:\+?91)?[6-9]\d{9}/);
    if (!phoneMatch) return null;
    const phone = phoneMatch[0];
    let name = raw.replace(phone, '').replace(/^[\s,\-\t:|]+|[\s,\-\t:|]+$/g, '').trim() || 'Friend';
    return {
      phone,
      name,
      discount: '20% OFF',
      link: 'http://localhost:3000'
    };
  }).filter(Boolean);
}

// --- 1. STATUS & AUTH ---

router.get('/status', (req, res) => {
  res.json(whatsappService.getStatus());
});

router.get('/qr', (req, res) => {
  const qr = whatsappService.getQr();
  if (!qr) {
    return res.status(404).json({
      success: false,
      message: 'No QR code available. Status is: ' + whatsappService.status
    });
  }
  res.json({ success: true, qr: qr.dataUrl, raw: qr.raw });
});

router.post('/qr/refresh', async (req, res) => {
  try {
    const result = await whatsappService.forceRefreshQr();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Please provide a valid "phone" number' });
    }
    const result = await whatsappService.requestPairingCode(phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const result = await whatsappService.logout();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. MESSAGE SENDING ---

router.post('/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing "phone" or "message" parameter' });
    }

    const result = await whatsappService.sendTextMessage(phone, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/send-media', upload.single('media'), async (req, res) => {
  try {
    const { phone, caption } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Missing "phone" parameter' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Missing media file upload ("media")' });
    }

    const result = await whatsappService.sendImageMessage(phone, req.file.path, caption || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 3. E-COMMERCE PRE-CONFIGURED TEMPLATES (GoWhats Model) ---

router.post('/templates/cod-confirm', async (req, res) => {
  try {
    const { phone, customerName, orderId, amount, address, storeName } = req.body;
    if (!phone || !customerName || !orderId || !amount || !address) {
      return res.status(400).json({
        error: 'Missing required fields: phone, customerName, orderId, amount, address'
      });
    }

    const result = await whatsappService.sendCodVerification({
      phone,
      customerName,
      orderId,
      amount,
      address,
      storeName
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates/order-receipt', async (req, res) => {
  try {
    const { phone, customerName, orderId, items, total, trackingUrl, storeName } = req.body;
    if (!phone || !customerName || !orderId || !total) {
      return res.status(400).json({
        error: 'Missing required fields: phone, customerName, orderId, total'
      });
    }

    const result = await whatsappService.sendOrderReceipt({
      phone,
      customerName,
      orderId,
      items,
      total,
      trackingUrl,
      storeName
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates/abandoned-cart', async (req, res) => {
  try {
    const { phone, customerName, itemsSummary, checkoutLink, discountCode, storeName } = req.body;
    if (!phone || !customerName || !checkoutLink) {
      return res.status(400).json({
        error: 'Missing required fields: phone, customerName, checkoutLink'
      });
    }

    const result = await whatsappService.sendAbandonedCart({
      phone,
      customerName,
      itemsSummary,
      checkoutLink,
      discountCode,
      storeName
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 4. CAMPAIGN BROADCAST ENGINE ---

router.post('/broadcast', upload.single('media'), async (req, res) => {
  try {
    let contacts = [];
    if (typeof req.body.contacts === 'string') {
      const rawText = req.body.contacts.trim();
      if (rawText.startsWith('[') && rawText.endsWith(']')) {
        try {
          contacts = JSON.parse(rawText);
        } catch (e) {
          contacts = parseContactsText(rawText);
        }
      } else {
        contacts = parseContactsText(rawText);
      }
    } else if (Array.isArray(req.body.contacts)) {
      contacts = req.body.contacts;
    }

    const { name, template, minDelaySec, maxDelaySec } = req.body;

    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'Contacts list cannot be empty' });
    }
    if (!template) {
      return res.status(400).json({ error: 'Message "template" is required' });
    }

    const mediaPath = req.file ? req.file.path : null;

    const result = await whatsappService.startBroadcast({
      name: name || 'Broadcast Campaign',
      contacts,
      template,
      mediaPath,
      minDelaySec: Number(minDelaySec) || 20,
      maxDelaySec: Number(maxDelaySec) || 40
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/broadcast/status', (req, res) => {
  res.json(whatsappService.campaign);
});

router.post('/broadcast/cancel', (req, res) => {
  res.json(whatsappService.cancelBroadcast());
});

// --- 5. MESSAGE INBOX & LOGS ---

router.get('/messages', (req, res) => {
  res.json({
    total: whatsappService.messages.length,
    messages: whatsappService.messages
  });
});

export default router;
