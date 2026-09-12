const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ۱. مدیریت آپلود و سرو فایل‌ها
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadDir));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fullUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fullUrl, filename: req.file.filename });
});

// ۲. رله پیام‌رسان‌های بله و ایتا
app.all('/bale/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const response = await axios({
      method: req.method,
      url: `https://tapi.bale.ai/${targetPath}`,
      data: req.body,
      params: req.query
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const response = await axios({
      method: req.method,
      url: `https://eitaayar.ir/${targetPath}`,
      data: req.body,
      params: req.query
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// ۳. موتور واتساپ با پروکسی پورت 8443 و کنترل ریکانکت
let waSocket = null;
let isConnected = false;
let reconnectTimer = null;

async function startWhatsApp() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const authFolder = path.join(__dirname, 'auth_whatsapp');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

  // عبور ترافیک واتساپ از پورت 8443 سرور خارج
  const proxyAgent = new HttpsProxyAgent('http://31.58.179.16:8443');

  waSocket = makeWASocket({
    version,
    auth: state,
    agent: proxyAgent,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000
  });

  waSocket.ev.on('creds.update', saveCreds);

  waSocket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n================ QR CODE WHATSAPP ================');
      qrcode.generate(qr, { small: true });
      console.log('لطفاً بارکد بالا را با واتساپ گوشی اسکن کنید');
      console.log('===================================================\n');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || lastDisconnect?.error;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[WhatsApp] اتصال قطع شد | علت: ${errorMessage} | کد: ${statusCode || 'نامشخص'}`);

      if (shouldReconnect) {
        console.log('[WhatsApp] تلاش مجدد برای برقراری ارتباط تا ۶ ثانیه دیگر...');
        reconnectTimer = setTimeout(() => {
          startWhatsApp();
        }, 6000);
      } else {
        console.log('[WhatsApp] نشست کاربری منقضی شد (Logged Out). پوشه auth_whatsapp باید ریست شود.');
      }
    } else if (connection === 'open') {
      isConnected = true;
      console.log('[WhatsApp] با موفقیت به واتساپ متصل شد و آماده دریافت درخواست است.');
    }
  });
}

startWhatsApp();

// ۴. اندپوینت اختصاصی ارسال پیام و مدیا در واتساپ
app.post('/whatsapp/send', async (req, res) => {
  if (!isConnected || !waSocket) {
    return res.status(503).json({ 
      error: 'WhatsApp is not connected yet. Check server logs for QR code.' 
    });
  }

  try {
    let { number, text, mediaUrl, mediaType, caption } = req.body;
    if (!number) return res.status(400).json({ error: 'Field "number" is required' });

    let jid = number.includes('@') ? number : `${number.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    let result;

    if (mediaUrl) {
      if (mediaType === 'video') {
        result = await waSocket.sendMessage(jid, { video: { url: mediaUrl }, caption: caption || text || '' });
      } else {
        result = await waSocket.sendMessage(jid, { image: { url: mediaUrl }, caption: caption || text || '' });
      }
    } else {
      result = await waSocket.sendMessage(jid, { text: text || '' });
    }

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
