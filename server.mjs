// server.mjs - COMPLETE ULTIMATE PRODUCTION VERSION v3.0
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const MODEL_NAME = 'gpt-5-nano';
const MAX_COMPLETION_TOKENS = 8000; // Optimal: Yeterli ama fazla değil
const OPENAI_TIMEOUT = 90000; // 90 saniye
const JSON_SIZE_LIMIT = '2mb';

// ═══════════════════════════════════════════════════════════════
// OpenAI Client Initialization
// ═══════════════════════════════════════════════════════════════
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ FATAL: OPENAI_API_KEY .env dosyasında tanımlı değil!');
  console.error('💡 .env dosyası oluşturun ve OPENAI_API_KEY=your_key_here ekleyin');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: OPENAI_TIMEOUT,
});

// ═══════════════════════════════════════════════════════════════
// Express Middleware
// ═══════════════════════════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: JSON_SIZE_LIMIT }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT (Optimize Edilmiş - Kısa ve Etkili)
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Sen uzman bir gezi planlayıcısısın. GERÇEK mekanlardan oluşan detaylı planlar oluşturursun.

KURALLAR:
1. SADECE gerçek mekanlar (müze, park, restoran, kafe, anıt)
2. Mekan isimleri Google Maps'te aranabilir olmalı
3. Tam adres ver (sokak, mahalle, ilçe)
4. Zaman dilimleri gerçekçi, mantıklı güzergah
5. Bütçe ve süre kullanıcı isteğine uygun
6. İlgi alanları ve kalabalık tercihine göre seç

KOORDİNAT KURALI:
- Biliyorsan "lat" ve "lng" yaz (gerçek koordinat)
- Emin değilsen null bırak, UYDURMA

ÇIKTI (SADECE JSON):
{
  "id": "unique_id",
  "createdAt": "2024-01-01T10:00:00Z",
  "summary": "Plan özeti (2-3 cümle)",
  "estimatedTotalCost": 500,
  "currency": "TRY",
  "stops": [
    {
      "timeRange": "09:00 - 10:30",
      "placeName": "Gerçek mekan adı",
      "address": "Tam adres",
      "description": "Detaylı bilgi (2-5 cümle)",
      "reason": "Neden seçildi",
      "estimatedCost": 50,
      "crowd": "az|orta|yoğun",
      "transport": "Önceki duraktan nasıl gidilir",
      "lat": 41.0082,
      "lng": 28.9784,
      "rating": 4.5,
      "ratingCount": 1200,
      "priceLevel": 2,
      "category": "Kahvaltı|Müze|Park|Restoran|Kafe|Alışveriş|Gece Hayatı",
      "duration": 90
    }
  ],
  "tips": ["Pratik öneri 1", "Pratik öneri 2"]
}

ÖNEMLİ:
- İstanbul: Sultanahmet, Taksim, Beşiktaş, Kadıköy (gerçek semtler)
- Paris: Eiffel, Louvre, Montmartre (gerçek yerler)
- "lat", "lng" bilmiyorsan null
- Her durak 60-180 dakika
- Ulaşım mantıklı ve gerçekçi`;

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Kullanıcı isteğinden prompt oluşturur
 */
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
    walk: 'yürüyerek (kısa mesafeler)',
    public: 'toplu taşıma (metro, tramvay, otobüs)',
    taxi: 'taksi/özel araç',
  };

  const crowdMap = {
    avoid: 'kalabalık yerlerden kaçın, sakin yerler',
    prefer: 'canlı ve kalabalık yerler',
    any: 'kalabalık önemli değil',
  };

  const isEnglish = language === 'en';
  const langLabel = isEnglish ? 'English' : 'Turkish';
  const isDetailed = qualityMode === 'detailed' || qualityMode === 'ultra';

  return `Şehir: ${city}
Tarih: ${date}
Süre: ${hours} saat (başlangıç: ${startTime})
Bütçe: ${budget} ${body.currency || 'TRY'}
İlgi alanları: ${interestsText || (isEnglish ? 'General' : 'Genel')}
Kalabalık: ${crowdMap[crowdPreference] || crowdPreference}
Ulaşım: ${mobilityMap[mobility] || mobility}
Özel istek: ${specialRequest || '-'}

GEREKSİNİMLER:
- 3-5 durak oluştur
- Coğrafi olarak mantıklı güzergah
- İlgi alanları ve kalabalık tercihini dikkate al
- Bütçeyi aşma
- ${isDetailed ? 'Her durak için 3-4 cümle açıklama, detaylı ipuçları' : 'Her durak için 1-2 cümle, kısa ipuçları'}

DİL: ${langLabel}

SADECE GEÇERLİ JSON DÖNDÜR, BAŞKA METİN YOK.`;
}

/**
 * OpenAI yanıtından JSON çıkarır (Geliştirilmiş)
 */
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Direkt parse dene
  try {
    return JSON.parse(text);
  } catch (e) {}

  // 2. Markdown code block temizle
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // 3. Regex ile en büyük JSON objesini bul
  const matches = cleaned.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g);
  if (matches && matches.length > 0) {
    const longest = matches.reduce((a, b) => (a.length > b.length ? a : b));
    try {
      return JSON.parse(longest);
    } catch (e) {}
  }

  return null;
}

/**
 * Plan validasyonu ve normalize etme (ROBUST)
 */
function validateAndFixPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Geçersiz plan formatı');
  }

  // Plan meta bilgileri
  plan.id = plan.id || `plan_${Date.now()}`;
  plan.createdAt = plan.createdAt || new Date().toISOString();
  plan.currency = plan.currency || 'TRY';
  plan.summary = plan.summary || 'Gezi planı';
  plan.estimatedTotalCost = plan.estimatedTotalCost || 0;
  plan.tips = Array.isArray(plan.tips) ? plan.tips : [];
  plan.stops = Array.isArray(plan.stops) ? plan.stops : [];
  plan.language = plan.language || 'tr';

  // Durakları normalize et
  plan.stops = plan.stops.map((stop, index) => {
    if (!stop || typeof stop !== 'object') {
      stop = {};
    }

    let lat = stop.lat;
    let lng = stop.lng;

    // ROBUST koordinat validasyonu
    // - Sayı olmalı
    // - 0 olmamalı (geçersiz koordinat)
    // - NaN veya Infinity olmamalı
    // - Geçerli range'de olmalı (-90/90, -180/180)
    if (
      typeof lat !== 'number' ||
      lat === 0 ||
      isNaN(lat) ||
      !isFinite(lat) ||
      lat < -90 ||
      lat > 90
    ) {
      lat = null;
    }

    if (
      typeof lng !== 'number' ||
      lng === 0 ||
      isNaN(lng) ||
      !isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
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

/**
 * OpenAI API çağrısı (retry + logging)
 * GPT-5-nano UYUMLU
 */
async function callOpenAI(userPrompt, retryCount = 0) {
  console.log(
    `\n📤 OpenAI isteği gönderiliyor... (Deneme: ${retryCount + 1}/3)`,
  );
  console.log('📦 Model:', MODEL_NAME);
  console.log('🎯 Max tokens:', MAX_COMPLETION_TOKENS);

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      // NOT: GPT-5-nano aşağıdaki parametreleri desteklemiyor:
      // - reasoning (sadece GPT-5 full/mini)
      // - temperature (sadece default 1)
      // - top_p
      // - presence_penalty
      // - frequency_penalty
    });

    console.log('📥 Yanıt alındı');
    console.log('   - Model:', response?.model);
    console.log('   - Usage:', JSON.stringify(response?.usage));
    console.log('   - Finish reason:', response?.choices?.[0]?.finish_reason);

    // Reasoning tokens detayı varsa göster (GPT-5 full/mini için)
    if (response?.usage?.completion_tokens_details) {
      const details = response.usage.completion_tokens_details;
      if (details.reasoning_tokens) {
        console.log('   - Reasoning tokens:', details.reasoning_tokens);
      }
    }

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI yanıtında içerik yok');
    }

    console.log('   - Content length:', content.length, 'chars');
    return content;
  } catch (apiError) {
    console.error('❌ OpenAI hatası:', apiError.message);
    console.error('   - Status:', apiError.status);
    console.error('   - Code:', apiError.code);
    console.error('   - Type:', apiError.type);

    // Geçici hatalarda retry (429: rate limit, 503: service unavailable)
    if (
      retryCount < 2 &&
      (apiError.status === 429 || apiError.status === 503)
    ) {
      const waitTime = (retryCount + 1) * 2000; // 2s, 4s
      console.log(`⏳ ${waitTime}ms bekleyip tekrar denenecek...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return callOpenAI(userPrompt, retryCount + 1);
    }

    throw new Error(`OpenAI hatası: ${apiError.message}`);
  }
}

/**
 * Plan oluşturma (ana fonksiyon)
 */
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

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/plan
 * Yeni plan oluşturur
 */
app.post('/api/plan', async (req, res) => {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(60));
  console.log('📍 POST /api/plan');
  console.log('📦 Request body:', JSON.stringify(req.body, null, 2));

  try {
    const prompt = buildPrompt(req.body);
    const plan = await createPlan(prompt);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Plan oluşturuldu (${duration}s)`);
    console.log('═'.repeat(60));

    res.json(plan);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Plan oluşturma hatası (${duration}s):`, err.message);
    console.error('═'.repeat(60));

    res.status(500).json({
      error: 'Plan oluşturulamadı',
      detail: err.message,
    });
  }
});

/**
 * POST /api/plan/chat
 * Mevcut planı günceller
 */
app.post('/api/plan/chat', async (req, res) => {
  const startTime = Date.now();
  console.log('\n' + '═'.repeat(60));
  console.log('📍 POST /api/plan/chat');

  try {
    const { plan, message } = req.body || {};

    if (!plan || !message) {
      return res.status(400).json({
        error: 'Geçersiz istek',
        detail: 'plan ve message parametreleri zorunlu',
      });
    }

    console.log('💬 Kullanıcı mesajı:', message);
    console.log('📋 Mevcut plan ID:', plan.id);

    const language = plan.language || 'tr';
    const isEnglish = language === 'en';

    const prompt = `${isEnglish ? 'Current plan' : 'Mevcut plan'}:
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
    console.log('═'.repeat(60));

    res.json(newPlan);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Plan güncelleme hatası (${duration}s):`, err.message);
    console.error('═'.repeat(60));

    res.status(500).json({
      error: 'Plan güncellenemedi',
      detail: err.message,
    });
  }
});

/**
 * GET /api/test
 * OpenAI bağlantısını test eder
 */
app.get('/api/test', async (_req, res) => {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 GET /api/test');

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: 'Test: Sadece "OK" yaz.' }],
      max_completion_tokens: 100,
    });

    const content = response.choices?.[0]?.message?.content;
    console.log('✅ Test başarılı:', content);
    console.log('═'.repeat(60));

    res.json({
      success: true,
      model: MODEL_NAME,
      response: content,
      usage: response.usage,
    });
  } catch (err) {
    console.error('❌ Test hatası:', err.message);
    console.error('═'.repeat(60));

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/health
 * Sunucu sağlık durumunu kontrol eder
 */
app.get('/api/health', (_req, res) => {
  const memUsage = process.memoryUsage();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    model: MODEL_NAME,
    version: '3.0',
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
    },
    config: {
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      timeout: OPENAI_TIMEOUT / 1000 + 's',
      jsonLimit: JSON_SIZE_LIMIT,
    },
  });
});

/**
 * GET /
 * API bilgilerini döndürür
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'TripPlan API',
    version: '3.0 - Ultimate Production',
    status: 'online',
    model: MODEL_NAME,
    features: {
      model: 'GPT-5-Nano (low-cost, low-latency)',
      maxTokens: MAX_COMPLETION_TOKENS,
      robustValidation: true,
      healthMonitoring: true,
      retryLogic: true,
    },
    endpoints: {
      createPlan: {
        method: 'POST',
        path: '/api/plan',
        description: 'Yeni gezi planı oluşturur',
      },
      updatePlan: {
        method: 'POST',
        path: '/api/plan/chat',
        description: 'Mevcut planı günceller',
      },
      test: {
        method: 'GET',
        path: '/api/test',
        description: 'OpenAI bağlantısını test eder',
      },
      health: {
        method: 'GET',
        path: '/api/health',
        description: 'Sunucu sağlık durumunu kontrol eder',
      },
    },
    documentation: 'https://github.com/your-repo/tripplan-api',
  });
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

/**
 * 404 handler
 */
app.use((_req, res) => {
  res.status(404).json({
    error: 'Endpoint bulunamadı',
    message: 'Geçerli endpoint listesi için GET / adresine istek atın',
  });
});

/**
 * Global error handler
 */
app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err);

  res.status(500).json({
    error: 'Sunucu hatası',
    detail:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
  });
});

// ═══════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════

app.listen(port, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('✅ TripPlan Backend v3.0 - ULTIMATE PRODUCTION');
  console.log('═'.repeat(60));
  console.log(`🌐 Server       : http://localhost:${port}`);
  console.log(`📦 Model        : ${MODEL_NAME}`);
  console.log(`🎯 Max Tokens   : ${MAX_COMPLETION_TOKENS}`);
  console.log(`⏱️  Timeout      : ${OPENAI_TIMEOUT / 1000}s`);
  console.log(`📊 JSON Limit   : ${JSON_SIZE_LIMIT}`);
  console.log('═'.repeat(60));
  console.log('📍 Endpoints:');
  console.log('   POST /api/plan       - Yeni plan oluştur');
  console.log('   POST /api/plan/chat  - Planı güncelle');
  console.log('   GET  /api/test       - OpenAI test');
  console.log('   GET  /api/health     - Health check');
  console.log('   GET  /              - API bilgisi');
  console.log('═'.repeat(60));
  console.log('⚡ Optimizations:');
  console.log('   ✓ GPT-5-nano uyumlu');
  console.log('   ✓ Robust koordinat validasyonu');
  console.log('   ✓ Automatic retry logic');
  console.log('   ✓ Memory monitoring');
  console.log('   ✓ Request logging');
  console.log('═'.repeat(60));
  console.log('🚀 Server hazır! Kullanıma başlayabilirsiniz.\n');
});
