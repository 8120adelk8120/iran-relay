const express = require('express');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ۱. مدیریت پوشه ذخیره فایل‌ها
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ۲. تنظیمات Multer
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
  limits: { fileSize: 200 * 1024 * 1024 }
});

// ۳. مسیر استاتیک دانلود فایل‌ها
app.use('/uploads', express.static(uploadDir));

// ۴. اندپوینت آپلود
app.post('/upload', upload.any(), (req, res) => {
  const uploadedFile = req.files && req.files.length > 0 ? req.files[0] : req.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'هیچ فایلی دریافت نشد' });
  }
  const fileUrl = `https://relay.jetback.shop/uploads/${uploadedFile.filename}`;
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

// ۶. رله هوشمند ایتا (تبدیل خودکار لینک عکس و ویدیو به فایل واقعی)
app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const targetUrl = `https://eitaayar.ir/${targetPath}`;

    // اگر درخواست ارسال فایل باشد و لینک فایل فرستاده شده باشد
    if (targetPath.endsWith('sendFile') && req.body && req.body.file) {
      const fileSource = req.body.file;
      let fileBuffer;
      let fileName = 'media_file.jpg';

      // بررسی وجود فایل در هاست محلی سرور
      if (typeof fileSource === 'string' && fileSource.includes('/uploads/')) {
        const localFileName = path.basename(fileSource.split('?')[0]);
        const localPath = path.join(uploadDir, localFileName);
        if (fs.existsSync(localPath)) {
          fileBuffer = fs.readFileSync(localPath);
          fileName = localFileName;
        }
      }

      // دانلود در صورت قرار داشتن فایل روی هاست خارجی
      if (!fileBuffer) {
        const fileRes = await axios.get(fileSource, { responseType: 'arraybuffer' });
        fileBuffer = Buffer.from(fileRes.data);
        fileName = path.basename(fileSource.split('?')[0]) || 'media_file.jpg';
      }

      // بسته‌بندی فایل به صورت فرم Multipart واقعی برای سرور ایتا
      const formData = new FormData();
      formData.append('chat_id', req.body.chat_id);
      if (req.body.caption) formData.append('caption', req.body.caption.slice(0, 1200));

      const blob = new Blob([fileBuffer]);
      formData.append('file', blob, fileName);

      const response = await fetch(targetUrl, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // درخواست‌های معمولی مثل sendMessage
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

app.get('/', (req, res) => {
  res.send('Relay & Media Storage Server is Running.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
