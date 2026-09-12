const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
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

// ۱. مدیریت فایل‌های آپلودی
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

// ۳. موتور اختصاصی واتساپ (Baileys)
let waSocket = null;
let isConnected = false;

async function startWhatsApp() {
  const authFolder = path.join(__dirname, 'auth_whatsapp');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
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
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`اتصال واتساپ قطع شد. تلاش مجدد: ${shouldReconnect}`);
      if (shouldReconnect) startWhatsApp();
    } else if (connection === 'open') {
      isConnected = true;
      console.log('واتساپ با موفقیت متصل شد و آماده ارسال پیام است.');
    }
  });
}

startWhatsApp();

// ۴. اندپوینت اختصاصی ارسال پیام و مدیا در واتساپ
app.post('/whatsapp/send', async (req, res) => {
  if (!isConnected || !waSocket) {
    return res.status(503).json({ error: 'WhatsApp is not connected yet. Check server logs for QR code.' });
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
