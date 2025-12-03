// server.mjs
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY .env içinde tanımlı değil!');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model - gpt-5-nano
const MODEL_NAME = 'gpt-5-nano';

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────────────────────────
// Sistem promptu
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Sen bir gezi planlayıcısısın. Verilen bilgilere göre gezi planı oluştur.

SADECE JSON formatında yanıt ver. Başka hiçbir şey yazma:

{
  "summary": "Plan özeti",
  "estimatedTotalCost": 500,
  "currency": "TRY",
  "stops": [
    {
      "timeRange": "09:00 - 10:30",
      "placeName": "Mekan",
      "address": "Adres",
      "description": "Açıklama",
      "reason": "Neden",
      "estimatedCost": 50,
      "crowd": "az",
      "transport": "Yürüyerek",
      "lat": 41.0,
      "lng": 28.9,
      "rating": 4.5,
      "ratingCount": 100,
      "priceLevel": 2,
      "category": "Kahvaltı",
      "duration": 90
    }
  ],
  "tips": ["İpucu 1"]
}`;

// ─────────────────────────────────────────────────────────────
// Prompt builder
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
  } = body || {};

  const interestsText = Array.isArray(interests) ? interests.join(', ') : interests;

  return `Şehir: ${city}
Tarih: ${date}
Süre: ${hours} saat (${startTime}'dan başla)
Bütçe: ${budget} TL
İlgi alanları: ${interestsText || 'Genel'}
Kalabalık: ${crowdPreference}
Ulaşım: ${mobility}
${specialRequest ? `Özel istek: ${specialRequest}` : ''}
Dil: ${language === 'en' ? 'İngilizce' : 'Türkçe'}

3-5 durak içeren plan oluştur. SADECE JSON döndür.`;
}

// ─────────────────────────────────────────────────────────────
// JSON çıkarma fonksiyonu
// ─────────────────────────────────────────────────────────────
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Direkt parse dene
  try {
    return JSON.parse(text);
  } catch (e) {}

  // 2. Temizle ve dene
  let cleaned = text.trim();

  // Markdown code block temizle
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // 3. Regex ile JSON bul
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {}
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// OpenAI API çağrısı
// ─────────────────────────────────────────────────────────────
async function callOpenAI(userPrompt) {
  console.log('\n📤 OpenAI isteği gönderiliyor...');
  console.log('📦 Model:', MODEL_NAME);

  let rawResponse;

  try {
    // temperature ve max_tokens gönderME
    rawResponse = await client.chat.completions.create({
      model: MODEL_NAME,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    console.log('📥 Ham yanıt alındı');
  } catch (apiError) {
    console.error('❌ OpenAI API hatası:', apiError.message);
    console.error('❌ Hata tipi:', apiError.constructor.name);
    console.error('❌ Status:', apiError.status);
    console.error('❌ Code:', apiError.code);

    if (apiError.error) {
      console.error('❌ Error body:', JSON.stringify(apiError.error, null, 2));
    }

    throw new Error(`OpenAI API hatası: ${apiError.message}`);
  }

  // Yanıtı incele
  console.log('🔍 Yanıt yapısı:');
  console.log('   - id:', rawResponse?.id);
  console.log('   - model:', rawResponse?.model);
  console.log('   - choices length:', rawResponse?.choices?.length);

  if (rawResponse?.usage) {
    console.log('   - tokens:', JSON.stringify(rawResponse.usage));
  }

  const choice = rawResponse?.choices?.[0];
  if (!choice) {
    console.error('❌ Choices boş:', JSON.stringify(rawResponse, null, 2));
    throw new Error('OpenAI yanıtında choices bulunamadı');
  }

  console.log('   - finish_reason:', choice.finish_reason);

  const content = choice.message?.content;
  console.log('   - content type:', typeof content);
  console.log('   - content length:', content?.length);

  if (!content) {
    console.error('❌ Content boş. Tam yanıt:', JSON.stringify(rawResponse, null, 2));
    throw new Error('OpenAI yanıtında content boş');
  }

  // Content'i logla (ilk 1000 karakter)
  console.log('📄 Content preview:', content.substring(0, 1000));

  return content;
}

// ─────────────────────────────────────────────────────────────
// Plan oluşturma
// ─────────────────────────────────────────────────────────────
async function createPlan(userPrompt) {
  const content = await callOpenAI(userPrompt);

  // JSON parse
  const plan = extractJsonFromText(content);

  if (!plan || typeof plan !== 'object') {
    console.error('❌ JSON parse başarısız');
    console.error('❌ Alınan content:', content);
    throw new Error('Geçerli JSON alınamadı');
  }

  // Varsayılan alanları ekle
  plan.id = plan.id || Date.now().toString();
  plan.createdAt = plan.createdAt || new Date().toISOString();
  plan.currency = plan.currency || 'TRY';
  plan.stops = Array.isArray(plan.stops) ? plan.stops : [];
  plan.tips = Array.isArray(plan.tips) ? plan.tips : [];

  console.log('✅ Plan hazır. Durak sayısı:', plan.stops.length);

  return plan;
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

// POST /api/plan
app.post('/api/plan', async (req, res) => {
  console.log('\n' + '═'.repeat(50));
  console.log('📍 POST /api/plan');
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));

  try {
    const prompt = buildPrompt(req.body);
    const plan = await createPlan(prompt);

    console.log('✅ Yanıt gönderiliyor');
    res.json(plan);
  } catch (err) {
    console.error('❌ Hata:', err.message);
    res.status(500).json({
      error: 'Plan oluşturulamadı',
      detail: err.message,
    });
  }
});

// POST /api/plan/chat
app.post('/api/plan/chat', async (req, res) => {
  console.log('\n' + '═'.repeat(50));
  console.log('📍 POST /api/plan/chat');

  try {
    const { plan, message } = req.body || {};

    if (!plan || !message) {
      return res.status(400).json({
        error: 'Geçersiz istek',
        detail: 'plan ve message zorunlu',
      });
    }

    const prompt = `Mevcut plan:
${JSON.stringify(plan, null, 2)}

Kullanıcı: ${message}

Planı güncelle. SADECE JSON döndür.`;

    const newPlan = await createPlan(prompt);
    res.json(newPlan);
  } catch (err) {
    console.error('❌ Hata:', err.message);
    res.status(500).json({
      error: 'Plan güncellenemedi',
      detail: err.message,
    });
  }
});

// GET /api/test - Basit test
app.get('/api/test', async (_req, res) => {
  console.log('\n' + '═'.repeat(50));
  console.log('🧪 GET /api/test');

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: 'Sadece "Merhaba!" yaz.' }],
    });

    const content = response.choices?.[0]?.message?.content;
    console.log('✅ Test yanıtı:', content);

    res.json({
      success: true,
      model: MODEL_NAME,
      response: content,
      usage: response.usage,
    });
  } catch (err) {
    console.error('❌ Test hatası:', err.message);
    console.error('❌ Detay:', JSON.stringify(err, null, 2));

    res.status(500).json({
      success: false,
      error: err.message,
      details: err.error || null,
    });
  }
});

// GET /api/raw-test - Ham API yanıtını göster
app.get('/api/raw-test', async (_req, res) => {
  console.log('\n' + '═'.repeat(50));
  console.log('🧪 GET /api/raw-test');

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Sadece JSON döndür: {"test": true, "message": "hello"}',
        },
        { role: 'user', content: 'Test JSON döndür' },
      ],
    });

    console.log('📥 Ham yanıt:', JSON.stringify(response, null, 2));

    res.json({
      success: true,
      raw_response: response,
    });
  } catch (err) {
    console.error('❌ Raw test hatası:', err.message);

    res.status(500).json({
      success: false,
      error: err.message,
      error_type: err.constructor.name,
      error_details: {
        status: err.status,
        code: err.code,
        body: err.error,
      },
    });
  }
});

// GET /
app.get('/', (_req, res) => {
  res.json({
    status: 'running',
    model: MODEL_NAME,
    endpoints: ['/api/plan', '/api/plan/chat', '/api/test', '/api/raw-test'],
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log('═'.repeat(50));
  console.log(`✅ Backend: http://localhost:${port}`);
  console.log(`📦 Model: ${MODEL_NAME}`);
  console.log(`🧪 Test: http://localhost:${port}/api/test`);
  console.log(`🔬 Raw test: http://localhost:${port}/api/raw-test`);
  console.log('═'.repeat(50));
});
