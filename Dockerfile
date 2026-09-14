FROM node:18-alpine

WORKDIR /app

# نصب ابزارهای بیلد، موتور بومی FFmpeg و فونت‌های استاندارد فارسی/عربی
RUN apk add --no-cache git python3 make g++ ffmpeg font-noto-arabic ttf-dejavu

COPY package*.json ./

# نصب پکیج‌ها با فلگ legacy-peer-deps جهت حل تداخل sharp با کتابخانه واتساپ
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
