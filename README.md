# EDU FIND UZ

Node.js (bog'liqliksiz HTTP server + `pg`), PostgreSQL/Supabase va oddiy HTML/CSS/JS frontend.

## Hozir ishlaydigan funksiyalar
Kurs qidirish (shahar, byudjet, format), 2–4 kursni taqqoslash, narx holati va tekshirilgan sana, Verified / Tasdiqlanmagan / Eskirgan holatlari (Verified uchun manba havolasi majburiy), ro'yxatdan o'tish/kirish, sevimlilar, sharhlar (moderatsiyadan keyin ko'rinadi, admin "Verified talaba" belgisini beradi), yordam xabarlari, administrator paneli (kurs qo'shish, sharh moderatsiyasi, holat o'zgartirish, murojaatlar, audit log), AI yordamchi (server orqali, faqat bazadagi kurslar asosida).

## Hali qilinmagan (keyingi bosqichlar)
Interaktiv xarita, grantlar/stipendiyalar, kasblar bo'limi, ta'lim yangiliklari, markaz egasi kabineti, avtomatik ma'lumot yig'ish worker'i, bildirishnomalar, monetizatsiya, profil rasmi/qiziqishlar. Bu bo'limlar kodda mavjud emas.

## Ishga tushirish
1. Node.js 18+ va PostgreSQL (yoki Supabase) kerak.
2. `npm install`
3. `.env.example` ni `.env` ga nusxalang va to'ldiring (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`; AI uchun `ANTHROPIC_API_KEY`).
4. Muhit o'zgaruvchilarini yuklab migratsiya va serverni ishga tushiring:
   - Node 20.6+: `node --env-file=.env scripts/migrate.js` va `node --env-file=.env server/server.js`
   - Windows PowerShell: `Get-Content .env | % { if($_ -match '^([^#=]+)=(.*)$'){ [Environment]::SetEnvironmentVariable($matches[1],$matches[2]) } }` so'ng `npm run migrate` va `npm start`
5. Chrome'da `http://localhost:3000` oching.
6. `ADMIN_EMAIL` dagi email bilan ro'yxatdan o'ting — shu hisob administrator bo'ladi.

## Ma'lumotlar
Baza dastlab **bo'sh**: kurslarni admin panelidan qo'shasiz. Hech qanday uydirma ma'lumot yo'q. AI kalit bo'lmasa demo xabar qaytaradi.

## Xavfsizlik
Parollar scrypt bilan xeshlanadi, tokenlar HMAC bilan imzolanadi (7 kun), so'rovlar tezligi cheklangan, SQL parametrlashtirilgan, AI kaliti faqat serverda. Productionda HTTPS ortida ishlating.

## Test holati
Fayllar sintaksis tekshiruvidan o'tgan. PostgreSQL va internet bo'lmagani uchun to'liq ishga tushirib sinalmagan — birinchi ishga tushirishda xatolar chiqishi mumkin.
