import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRoutes from './routes/api.js';
import { whatsappService } from './services/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Disable browser caching for instant live UI updates
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Static frontend files
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'WhatsApp Automation & Marketing API',
    version: '1.0.0',
    whatsapp: whatsappService.getStatus()
  });
});

// Fallback to index.html for single-page dashboard
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 WhatsApp API Platform is running on: http://localhost:${PORT}`);
  console.log(`📱 Open your browser to link device and manage campaigns.`);
  console.log(`======================================================\n`);

  // Initialize WhatsApp connection automatically
  try {
    await whatsappService.initialize();
  } catch (err) {
    console.error('Failed to auto-initialize WhatsApp:', err.message);
  }
});
