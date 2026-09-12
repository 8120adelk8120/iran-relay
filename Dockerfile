FROM node:18-alpine

WORKDIR /app

# نصب ابزارهای مورد نیاز برای پکیج‌های شبکه و واتساپ
RUN apk add --no-cache git python3 make g++

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
