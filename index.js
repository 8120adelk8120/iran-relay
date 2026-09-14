const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// تنظیم میدل‌ورها و سقف ترافیک بادی (۱۰۰ مگابایت برای فایل‌های ویدیویی)
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// اطمینان از وجود پوشه محلی ذخیره‌سازی فایل‌ها
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// تنظیم ذخیره‌سازی فایل‌ها با پسوندهای امن و استاندارد
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
  limits: { fileSize: 100 * 1024 * 1024 }
});

// دسترسی مستقیم به فایل‌های آپلود شده
app.use('/uploads', express.static(uploadDir));

// اندپوینت بررسی سلامت سرور
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Darkube Media, Messaging & Aparat Relay' });
});

// اندپوینت آپلود ایمن رسانه‌ها
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

// رله هوشمند ایتا (تبدیل URL به فایل باینری فرمت FormData)
app.all('/eitaa/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const targetUrl = `https://eitaayar.ir/${targetPath}`;

    if (targetPath.includes('sendFile') && req.body && req.body.file) {
      let fileBuffer = null;
      let fileName = 'file.jpg';
      const fileUrl = req.body.file;

      // خواندن فایل از حافظه محلی در صورت آپلود پیشین روی همین سرور
      if (typeof fileUrl === 'string' && fileUrl.includes('/uploads/')) {
        const localFileName = fileUrl.split('/uploads/')[1].split('?')[0];
        const localFilePath = path.join(uploadDir, localFileName);
        if (fs.existsSync(localFilePath)) {
          fileBuffer = fs.readFileSync(localFilePath);
          fileName = localFileName;
        }
      }

      // دانلود مستقیم در صورت وجود لینک خارجی
      if (!fileBuffer && typeof fileUrl === 'string' && fileUrl.startsWith('http')) {
        const downloadRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 45000 });
        fileBuffer = downloadRes.data;
        try {
          const parsedName = path.basename(new URL(fileUrl).pathname);
          if (parsedName && parsedName.includes('.')) fileName = parsedName;
        } catch (_) {}
      }

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

// رله آپلود ویدیو به آپارات
app.post('/aparat/upload', async (req, res) => {
  try {
    const { username, password, ltoken, videoUrl, title, description, category, tags } = req.body;
    let token = ltoken;

    // ورود به آپارات در صورت عدم ارسال توکن مستقیم
    if (!token && username && password) {
      const hashPass = crypto.createHash('md5').update(password).digest('hex');
      const loginRes = await axios.get(`https://www.aparat.com/etc/api/login/luser/${username}/lpass/${hashPass}`);
      if (loginRes.data?.login?.type !== 'success') {
        return res.status(401).json({ error: 'خطا در ورود به آپارات: نام کاربری یا رمز عبور نامعتبر است.' });
      }
      token = loginRes.data.login.ltoken;
    }

    if (!token || !username) {
      return res.status(400).json({ error: 'نام کاربری و توکن/رمز عبور آپارات ارسال نشده است.' });
    }

    // دریافت آدرس و فرم آپلود موقت آپارات
    const formRes = await axios.get(`https://www.aparat.com/etc/api/uploadform/luser/${username}/ltoken/${token}`);
    const uploadData = formRes.data?.uploadform;
    if (!uploadData || !uploadData.formAction) {
      return res.status(500).json({ error: 'عدم موفقیت در دریافت فرم آپلود از آپارات', details: formRes.data });
    }

    // بازخوانی فایل ویدیویی از حافظه لوکال یا دانلود لینک
    let fileBuffer = null;
    let fileName = 'video.mp4';
    if (videoUrl && videoUrl.includes('/uploads/')) {
      const localFileName = videoUrl.split('/uploads/')[1].split('?')[0];
      const localFilePath = path.join(uploadDir, localFileName);
      if (fs.existsSync(localFilePath)) {
        fileBuffer = fs.readFileSync(localFilePath);
        fileName = localFileName;
      }
    }
    if (!fileBuffer && videoUrl) {
      const downloadRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fileBuffer = downloadRes.data;
    }

    if (!fileBuffer) {
      return res.status(400).json({ error: 'فایل ویدیو برای ارسال به آپارات یافت نشد.' });
    }

    // ساخت بسته استاندارد FormData برای سرور آپارات
    const formData = new FormData();
    const blob = new Blob([fileBuffer]);
    formData.append('video', blob, fileName);
    formData.append('frm-id', uploadData['frm-id']);
    formData.append('title', title || 'ویدیو جدید');
    formData.append('category', category || '7');
    formData.append('description', description || '');
    formData.append('tags', tags || 'خلاقیت,نوآوری,کسب_و_کار');

    const aparatRes = await fetch(uploadData.formAction, {
      method: 'POST',
      body: formData
    });

    const result = await aparatRes.json();
    res.json({ success: true, aparatResponse: result });
  } catch (err) {
    console.error('[Aparat Relay Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// میدل‌ور سراسری مدیریت خطا
app.use((err, req, res, next) => {
  console.error('[Global Handler]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Darkube Relay running on port ${PORT}`));
