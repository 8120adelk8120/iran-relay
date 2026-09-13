const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();

// میدل‌ورهای پایه و افزایش محدودیت حجم درخواست‌ها
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// اطمینان از وجود پوشه uploads در مسیر محلی پروژه
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// تنظیم ذخیره‌سازی ایمن فایل‌ها با Multer
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
  limits: { fileSize: 100 * 1024 * 1024 } // سقف ۱۰۰ مگابایت برای ویدیو و تصاویر
});

// دسترسی مستقیم مرورگر و وب‌سرویس‌ها به فایل‌های آپلود شده
app.use('/uploads', express.static(uploadDir));

// اندپوینت تست سلامت سرور
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Darkube Media & Messaging Relay' });
});

// اندپوینت آپلود فایل مقاوم در برابر خطای ۵۰۲
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
      timeout: 45000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[Bale Relay Error]:', err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// رله هوشمند ایتا (تبدیل خودکار لینک URL به فایل آپلودی چندبخشی multipart/form-data)
app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const targetUrl = `https://eitaayar.ir/${targetPath}`;

    // بررسی درخواست ارسال فایل حاوی URL
    if (targetPath.includes('sendFile') && req.body && req.body.file) {
      let fileBuffer = null;
      let fileName = 'file.jpg';
      const fileUrl = req.body.file;

      // ۱. اگر فایل قبلاً روی همین سرور آپلود شده، مستقیم از حافظه دیسک خوانده شود
      if (typeof fileUrl === 'string' && fileUrl.includes('/uploads/')) {
        const localFileName = fileUrl.split('/uploads/')[1].split('?')[0];
        const localFilePath = path.join(uploadDir, localFileName);
        if (fs.existsSync(localFilePath)) {
          fileBuffer = fs.readFileSync(localFilePath);
          fileName = localFileName;
        }
      }

      // ۲. در غیر این صورت، فایل از اینترنت دانلود و تبدیل به بافر شود
      if (!fileBuffer && typeof fileUrl === 'string' && fileUrl.startsWith('http')) {
        const downloadRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 45000 });
        fileBuffer = downloadRes.data;
        try {
          const parsedName = path.basename(new URL(fileUrl).pathname);
          if (parsedName && parsedName.includes('.')) fileName = parsedName;
        } catch (_) {}
      }

      // ۳. ساخت بسته استاندارد FormData برای API ایتا
      if (fileBuffer) {
        const formData = new FormData();
        formData.append('chat_id', req.body.chat_id);
        if (req.body.caption) formData.append('caption', req.body.caption);
        if (req.body.title) formData.append('title', req.body.title);

        const blob = new Blob([fileBuffer]);
        formData.append('file', blob, fileName);

        const eitaaResponse = await fetch(targetUrl, {
          method: 'POST',
          body: formData
        });

        const data = await eitaaResponse.json();
        return res.status(eitaaResponse.status).json(data);
      }
    }

    // درخواست‌های متنی معمول (مانند sendMessage)
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      params: req.query,
      headers: { 'Content-Type': 'application/json' },
      timeout: 45000
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[Eitaa Relay Error]:', err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// میدل‌ور سراسری برای جلوگیری از کرش سرور
app.use((err, req, res, next) => {
  console.error('[Global Handler]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Darkube Relay Service running on port ${PORT}`));
