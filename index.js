const express = require('express');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// پارس کردن درخواست‌های JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ۱. مدیریت پوشه ذخیره‌سازی فایل‌ها
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ۲. تنظیمات Multer برای نام‌گذاری و ذخیره فایل
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // سقف ۲۰۰ مگابایت برای ویدیو و عکس
});

// ۳. مسیر استاتیک دانلود مستقیم فایل
app.use('/uploads', express.static(uploadDir));

// ۴. اندپوینت اختصاصی آپلود مدیا
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'هیچ فایلی دریافت نشد' });
  }
  const fileUrl = `https://relay.jetback.shop/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// ۵. رله پیام‌رسان بله
app.all('/bale/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const targetUrl = `https://tapi.bale.ai/${targetPath}`;
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

// ۶. رله پیام‌رسان ایتا
app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const targetUrl = `https://eitaayar.ir/${targetPath}`;
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

// مسیر تست سلامت سرور
app.get('/', (req, res) => {
  res.send('Relay & Media Storage Server is Running.');
});

// راه‌اندازی سرور روی پورت ۳۰۰۰
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
