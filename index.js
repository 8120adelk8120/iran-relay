const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();

// میدل‌ورهای پایه و افزایش سقف حجم بادی
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// اطمینان از وجود پوشه uploads در مسیر پروژه
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// تنظیم ایمن ذخیره‌سازی فایل‌ها و مدیریت نام‌گذاری
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    let ext = '.jpg';
    if (file && file.originalname && file.originalname.includes('.')) {
      ext = path.extname(file.originalname);
    } else if (file && file.mimetype) {
      if (file.mimetype.includes('video')) ext = '.mp4';
      else if (file.mimetype.includes('png')) ext = '.png';
      else if (file.mimetype.includes('jpeg') || file.mimetype.includes('jpg')) ext = '.jpg';
    }
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // سقف ۱۰۰ مگابایت برای ویدیو و عکس
});

// دسترسی عمومی به فایل‌های آپلود شده
app.use('/uploads', express.static(uploadDir));

// اندپوینت بررسی سلامت سرور (جلوگیری از خطای ۴۰۴ روی ریشه)
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Darkube Media & Messaging Relay' });
});

// اندپوینت آپلود امن ضد کرش
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: `Upload error: ${err.message}` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'هیچ فایلی با کلید "file" ارسال نشده است.' });
    }

    // ساخت آدرس کامل فایل با در نظر گرفتن پروکسی کلودفلر
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const fullUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url: fullUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  });
});

// رله پیام‌رسان بله
app.all('/bale/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const response = await axios({
      method: req.method,
      url: `https://tapi.bale.ai/${targetPath}`,
      data: req.body,
      params: req.query,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// رله پیام‌رسان ایتا
app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const response = await axios({
      method: req.method,
      url: `https://eitaayar.ir/${targetPath}`,
      data: req.body,
      params: req.query,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// میدل‌ور سراسری مدیریت خطا برای جلوگیری از داون شدن سرور
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Darkube Relay running on port ${PORT}`));
