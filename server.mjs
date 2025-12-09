// server.mjs
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 3000;

const MAX_COMPLETION_TOKENS = 10000;

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY .env içinde tanımlı değil!');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 90000, // 90 saniye OpenAI timeout
});

const MODEL_NAME = 'gpt-5-nano';

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────────────────────────
// Sistem Promptu
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Sen dünya çapında uzman bir gezi planlayıcısısın. Verilen şehir ve kriterlere göre
**gerçek, ziyaret edilebilir** yerlerden oluşan detaylı ve mantıklı bir gezi planı oluşturursun.

GENEL KURALLAR:
1. Sadece GERÇEK ve bilinen mekanları seç (müzeler, parklar, restoranlar, anıtlar, kafeler vb.).
2. Mekan isimleri Google Haritalar'da aratılabilir, sade ve net olmalıdır
   (ör: "Galata Kulesi", "Topkapı Sarayı", "Dolmabahçe Sarayı").
3. Her durak için mümkünse tam adres ver (ilçe, mahalle, sokak, numara).
4. Zaman dilimleri gerçekçi olsun; aynı günde birbirine çok uzak semtler arasında zıplama.
5. Toplam süre ve bütçe kullanıcı isteğine uygun olsun.
6. Duraklar, kullanıcının ilgi alanlarına ve kalabalık tercihine göre seçilsin.
7. Ulaşım bilgisi gerçekçi olsun (yürüyerek mesafeler, toplu taşıma, araç vs.).

KOORDİNAT KURALI:
- Bir mekanın koordinatlarını GERÇEKTEN biliyorsan "lat" ve "lng" alanlarına yaz.
- Emin değilsen "lat" ve "lng" alanlarını null bırak. Uydurma koordinat verme.

ÇIKTI FORMATı (SADECE JSON):
{
  "id": "unique_id",
  "createdAt": "2024-01-01T10:00:00Z",
  "summary": "Planın genel özeti (2-3 cümle)",
  "estimatedTotalCost": 500,
  "currency": "TRY",
  "stops": [
    {
      "timeRange": "09:00 - 10:30",
      "placeName": "Gerçek mekan adı",
      "address": "Tam sokak adresi, mahalle, ilçe, şehir, ülke",
      "description": "Mekan hakkında detaylı bilgi (isteğe göre 2-5 cümle)",
      "reason": "Neden bu mekan seçildi, ilgi alanlarıyla bağlantısı",
      "estimatedCost": 50,
      "crowd": "az|orta|yoğun",
      "transport": "Bir önceki duraktan nasıl gidilir (örn: 'Taksim'den 15 dk yürüyüş')",
      "lat": 41.0082,        // Bilmiyorsan null
      "lng": 28.9784,        // Bilmiyorsan null
      "rating": 4.5,
      "ratingCount": 1200,
      "priceLevel": 2,       // 1: ucuz, 4: pahalı
      "category": "Kahvaltı|Müze|Park|Restoran|Kafe|Alışveriş|Gece Hayatı",
      "duration": 90         // dakika cinsinden süre
    }
  ],
  "tips": [
    "Pratik öneri 1",
    "Pratik öneri 2"
  ]
}

ÖNEMLİ NOTLAR:
- İstanbul için: Sultanahmet, Taksim, Beşiktaş, Kadıköy gibi gerçek semtler kullan.
- Paris için: Eiffel Kulesi, Louvre, Montmartre gibi gerçek yerler.
- "lat" ve "lng" bilmediğin yerlerde null olmalı; uydurma koordinat verme.
- Her durak en az 60, en fazla 180 dakika sürmeli.
- Duraklar arası ulaşım mantıklı ve süre olarak gerçekçi olmalı.
`;

// ─────────────────────────────────────────────────────────────
// Prompt Builder
// ─────────────────────────────────────────────────────────────
function buildPrompt(body) {
  const {
    city = 'İstanbul',
    date = 'Bugün',
    hours = 4,
    startTime = '09:00',
    budget = 500,
    interests = [],
    crowdPreference = 'any',
    mobility = 'walk',
    specialRequest = '',
    language = 'tr',
    qualityMode = 'detailed',
  } = body || {};

  const interestsText = Array.isArray(interests)
    ? interests.join(', ')
    : interests;

  const mobilityMap = {
    walk: 'yürüyerek (mesafeler kısa olsun)',
    public: 'toplu taşıma (metro, tramvay, otobüs)',
    taxi: 'taksi/özel araç',
  };

  const crowdMap = {
    avoid: 'kalabalık yerlerden kaçın, daha sakin yerler seç',
    prefer: 'canlı ve kalabalık yerleri tercih et',
    any: 'kalabalık konusunda özel bir tercih yok',
  };

  const isEnglish = language === 'en';
  const langLabel = isEnglish ? 'English' : 'Turkish';

  const isDetailed = qualityMode === 'detailed' || qualityMode === 'ultra';

  return `
City / Şehir: ${city}
Date / Tarih: ${date}
Total duration / Toplam süre: ${hours} saat (start / başlangıç: ${startTime})
Budget / Bütçe: ${budget} ${body.currency || 'TRY'}
Interests / İlgi alanları: ${
    interestsText || (isEnglish ? 'General tourism' : 'Genel gezi')
  }
Crowd preference / Kalabalık tercihi: ${
    crowdMap[crowdPreference] || crowdPreference
  }
Mobility / Ulaşım: ${mobilityMap[mobility] || mobility}
Special request / Özel istek: ${specialRequest || '-'}

REQUIREMENTS / GEREKSİNİMLER:
- 3 ile 5 arasında durak oluştur.
- Duraklar birbirine coğrafi olarak mantıklı bir güzergâh oluştursun.
- Kullanıcının ilgi alanları ve kalabalık tercihini dikkate al.
- Bütçeyi aşma; her durak için tahmini maliyet belirt.
- ${
    isDetailed
      ? 'Her durak için en az 3-4 cümle açıklama yaz, ipuçlarını detaylı ver.'
      : 'Her durak için kısa açıklamalar yaz (1-2 cümle), ipuçlarını kısa tut.'
  }

RESPONSE LANGUAGE / YANIT DİLİ: ${langLabel}

SADECE GEÇERLİ JSON DÖNDÜR, BAŞKA HİÇBİR METİN EKLEME.
`;
}

// ─────────────────────────────────────────────────────────────
// JSON çıkarma
// ─────────────────────────────────────────────────────────────
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    return JSON.parse(text);
  } catch (e) {}

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  const matches = cleaned.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g);
  if (matches && matches.length > 0) {
    const longest = matches.reduce((a, b) => (a.length > b.length ? a : b));
    try {
      return JSON.parse(longest);
    } catch (e) {}
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Plan validasyonu ve normalize etme
// ─────────────────────────────────────────────────────────────
function validateAndFixPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Geçersiz plan formatı');
  }

  plan.id = plan.id || `plan_${Date.now()}`;
  plan.createdAt = plan.createdAt || new Date().toISOString();
  plan.currency = plan.currency || 'TRY';
  plan.summary = plan.summary || 'Gezi planı';
  plan.estimatedTotalCost = plan.estimatedTotalCost || 0;
  plan.tips = Array.isArray(plan.tips) ? plan.tips : [];
  plan.stops = Array.isArray(plan.stops) ? plan.stops : [];
  plan.language = plan.language || 'tr';

  plan.stops = plan.stops.map((stop, index) => {
    if (!stop || typeof stop !== 'object') {
      stop = {};
    }

    let lat = stop.lat;
    let lng = stop.lng;

    if (typeof lat !== 'number') {
      lat = null;
    }
    if (typeof lng !== 'number') {
      lng = null;
    }

    return {
      timeRange: stop.timeRange || '09:00 - 10:00',
      placeName: stop.placeName || `Durak ${index + 1}`,
      address: stop.address || '',
      description: stop.description || '',
      reason: stop.reason || '',
      estimatedCost:
        typeof stop.estimatedCost === 'number' ? stop.estimatedCost : 0,
      crowd: stop.crowd || 'orta',
      transport: stop.transport || '',
      lat,
      lng,
      rating: typeof stop.rating === 'number' ? stop.rating : 0,
      ratingCount:
        typeof stop.ratingCount === 'number' ? stop.ratingCount : 0,
      priceLevel:
        typeof stop.priceLevel === 'number' ? stop.priceLevel : 1,
      category: stop.category || 'Genel',
      duration: typeof stop.duration === 'number' ? stop.duration : 60,
    };
  });

  return plan;
}

// ─────────────────────────────────────────────────────────────
// OpenAI çağrısı (retry + logging)
// ─────────────────────────────────────────────────────────────
async function callOpenAI(userPrompt, retryCount = 0) {
  console.log(
    `\n📤 OpenAI isteği gönderiliyor... (Deneme: ${retryCount + 1}/3)`,
  );
  console.log('📦 Model:', MODEL_NAME);

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });

    console.log('📥 Yanıt alındı');
    console.log('   - Model:', response?.model);
    console.log('   - Usage:', JSON.stringify(response?.usage));
    console.log('   - Finish reason:', response?.choices?.[0]?.finish_reason);

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI yanıtında içerik yok');
    }

    console.log('   - Content length:', content.length);
    return content;
  } catch (apiError) {
    console.error('❌ OpenAI hatası:', apiError.message);

    if (
      retryCount < 2 &&
      (apiError.status === 429 || apiError.status === 503)
    ) {
      const waitTime = (retryCount + 1) * 2000;
      console.log(`⏳ ${waitTime}ms bekleyip tekrar denenecek...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return callOpenAI(userPrompt, retryCount + 1);
    }

    throw new Error(`OpenAI hatası: ${apiError.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Plan oluşturma (ana fonksiyon)
// ─────────────────────────────────────────────────────────────
async function createPlan(userPrompt) {
  const content = await callOpenAI(userPrompt);
  const plan = extractJsonFromText(content);

  if (!plan) {
    console.error('❌ JSON parse başarısız');
    console.error('Content (first 500):', content?.substring(0, 500));
    throw new Error('Geçerli JSON alınamadı');
  }

  const validatedPlan = validateAndFixPlan(plan);

  console.log('✅ Plan hazır');
  console.log(`   - Durak sayısı: ${validatedPlan.stops.length}`);
  console.log(
    `   - Toplam maliyet: ${validatedPlan.estimatedTotalCost} ${validatedPlan.currency}`,
  );
  if (validatedPlan.stops[0]) {
    console.log(`   - İlk durak: ${validatedPlan.stops[0].placeName}`);
  }

  return validatedPlan;
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.post('/api/plan', async (req, res) => {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(60));
  console.log('📍 POST /api/plan');
  console.log('📦 Request:', JSON.stringify(req.body, null, 2));

  try {
    const prompt = buildPrompt(req.body);
    const plan = await createPlan(prompt);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Plan oluşturuldu (${duration}s)`);

    res.json(plan);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Hata (${duration}s):`, err.message);

    res.status(500).json({
      error: 'Plan oluşturulamadı',
      detail: err.message,
    });
  }
});

app.post('/api/plan/chat', async (req, res) => {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(60));
  console.log('📍 POST /api/plan/chat');

  try {
    const { plan, message } = req.body || {};

    if (!plan || !message) {
      return res.status(400).json({
        error: 'Geçersiz istek',
        detail: 'plan ve message zorunlu',
      });
    }

    const language = plan.language || 'tr';
    const isEnglish = language === 'en';

    const prompt = `${
      isEnglish ? 'Current plan' : 'Mevcut plan'
    }:
${JSON.stringify(plan, null, 2)}

${isEnglish ? 'User request' : 'Kullanıcı isteği'}: ${message}

${
  isEnglish
    ? 'UPDATE the plan based on the request. Keep real places, realistic times and budget. Do not change the general structure too much.'
    : 'Planı kullanıcı isteğine göre GÜNCELLE. Gerçek yerleri, gerçekçi süreleri ve bütçeyi koru. Genel yapıyı çok bozma.'
}

${isEnglish ? 'Return ONLY JSON.' : 'SADECE JSON döndür.'}`;

    const newPlan = await createPlan(prompt);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Plan güncellendi (${duration}s)`);

    res.json(newPlan);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Hata (${duration}s):`, err.message);

    res.status(500).json({
      error: 'Plan güncellenemedi',
      detail: err.message,
    });
  }
});

app.get('/api/test', async (_req, res) => {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 GET /api/test');

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: 'Test: Sadece "OK" yaz.' }],
    });

    const content = response.choices?.[0]?.message?.content;
    console.log('✅ Test başarılı:', content);

    res.json({
      success: true,
      model: MODEL_NAME,
      response: content,
      usage: response.usage,
    });
  } catch (err) {
    console.error('❌ Test hatası:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    model: MODEL_NAME,
    version: '2.0',
    endpoints: {
      plan: 'POST /api/plan',
      chat: 'POST /api/plan/chat',
      test: 'GET /api/test',
    },
  });
});

app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    error: 'Sunucu hatası',
    detail:
      process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.listen(port, () => {
  console.log('═'.repeat(60));
  console.log('✅ TripPlan Backend v2.0');
  console.log(`🌐 Server: http://localhost:${port}`);
  console.log(`📦 Model: ${MODEL_NAME}`);
  console.log('🧪 Test:  GET /api/test');
  console.log('═'.repeat(60));
});
