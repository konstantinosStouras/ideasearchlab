const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  provider: 'claude',                        // 'claude' | 'openai' | 'gemini'
  model: null,                               // null = use provider default below
  temperature: 1.0,
  maxTokens: 1000,
  contextWindow: 20,
  systemPrompt: null,
}

const PROVIDER_DEFAULTS = {
  claude: { model: 'claude-sonnet-4-20250514' },
  openai: { model: 'gpt-4o' },
  gemini: { model: 'gemini-1.5-pro' },
}

const SYSTEM_PROMPTS = {
  individual: `You are a creative ideation assistant helping an individual participant generate and develop ideas.
Your role is to:
- Ask probing questions that expand their thinking
- Suggest related angles or perspectives they haven't considered
- Challenge assumptions constructively
- Encourage creative connections between concepts
Be concise. Never generate the ideas for them directly — guide them to think deeper.`,

  group: `You are a creative ideation assistant supporting a small group working together.
The group has already generated individual ideas and is now collaborating.
Your role is to:
- Help the group find connections and patterns across their individual ideas
- Challenge the group to push beyond obvious solutions
- Suggest how two or more ideas could be combined
- Ask questions that surface disagreements productively
Be concise. Address the group, not just one person.`,
}

// ─── Load global AI settings from Firestore ───────────────────────────────────
async function loadGlobalAISettings() {
  const snap = await db.collection('settings').doc('ai').get()
  if (!snap.exists) return {}
  return snap.data()
}

// ─── Config resolver ──────────────────────────────────────────────────────────
function resolveAIConfig(sessionAIConfig, globalSettings, scope) {
  const provider = sessionAIConfig?.provider
    ?? globalSettings?.provider
    ?? DEFAULTS.provider

  const providerDefaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.claude

  return {
    provider,
    apiKey:        globalSettings?.apiKeys?.[provider] || null,
    model:         sessionAIConfig?.model         ?? globalSettings?.model         ?? providerDefaults.model,
    temperature:   sessionAIConfig?.temperature   ?? globalSettings?.temperature   ?? DEFAULTS.temperature,
    maxTokens:     sessionAIConfig?.maxTokens     ?? globalSettings?.maxTokens     ?? DEFAULTS.maxTokens,
    contextWindow: sessionAIConfig?.contextWindow ?? globalSettings?.contextWindow ?? DEFAULTS.contextWindow,
    systemPrompt:  sessionAIConfig?.systemPrompt  ?? globalSettings?.systemPrompt  ?? SYSTEM_PROMPTS[scope] ?? SYSTEM_PROMPTS.individual,
  }
}

// ─── Provider API calls ───────────────────────────────────────────────────────

async function callClaude(messages, config) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:       config.model,
      max_tokens:  config.maxTokens,
      temperature: config.temperature,
      system:      config.systemPrompt,
      messages,
    }),
  })
  if (!response.ok) throw new Error(`Claude API error: ${await response.text()}`)
  const data = await response.json()
  return data.content?.[0]?.text || ''
}

async function callOpenAI(messages, config) {
  // Convert to OpenAI message format (system message goes first)
  const openAIMessages = [
    { role: 'system', content: config.systemPrompt },
    ...messages,
  ]
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model:       config.model,
      max_tokens:  config.maxTokens,
      temperature: config.temperature,
      messages:    openAIMessages,
    }),
  })
  if (!response.ok) throw new Error(`OpenAI API error: ${await response.text()}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callGemini(messages, config) {
  // Convert to Gemini format
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: config.systemPrompt }] },
      contents,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    }),
  })
  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)
  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ─── Main LLM dispatcher ──────────────────────────────────────────────────────
async function callLLM(messages, config) {
  if (!config.apiKey) throw new Error(`No API key configured for provider: ${config.provider}`)

  switch (config.provider) {
    case 'claude': return callClaude(messages, config)
    case 'openai': return callOpenAI(messages, config)
    case 'gemini': return callGemini(messages, config)
    default: throw new Error(`Unknown provider: ${config.provider}`)
  }
}

// ─── Cloud Functions ──────────────────────────────────────────────────────────

/**
 * sendAIMessage
 * Called from AIChat component.
 */
exports.sendAIMessage = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId, scope, scopeId, userMessage } = data
  if (!sessionId || !scope || !scopeId || !userMessage) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.')
  }

  const [sessionSnap, globalSettings] = await Promise.all([
    db.collection('sessions').doc(sessionId).get(),
    loadGlobalAISettings(),
  ])

  if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
  const session = sessionSnap.data()

  if (scope === 'individual' && !session.aiConfig?.individualAI) {
    throw new functions.https.HttpsError('permission-denied', 'AI not enabled for individual phase.')
  }
  if (scope === 'group' && !session.aiConfig?.groupAI) {
    throw new functions.https.HttpsError('permission-denied', 'AI not enabled for group phase.')
  }

  const config = resolveAIConfig(session.aiConfig, globalSettings, scope)

  // Load conversation history
  const historySnap = await db
    .collection('sessions').doc(sessionId)
    .collection('aiMessages')
    .where('scope', '==', scope)
    .where('scopeId', '==', scopeId)
    .orderBy('timestamp', 'asc')
    .get()

  const history = historySnap.docs.map(d => ({
    role: d.data().role === 'assistant' ? 'assistant' : 'user',
    content: d.data().text,
  }))

  history.push({ role: 'user', content: userMessage })

  const assistantText = await callLLM(history.slice(-config.contextWindow), config)

  await db
    .collection('sessions').doc(sessionId)
    .collection('aiMessages')
    .add({
      role: 'assistant',
      text: assistantText,
      scope,
      scopeId,
      authorId: 'ai',
      authorName: 'AI Assistant',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { text: assistantText }
})

/**
 * saveAISettings
 * Instructor saves global AI provider settings and API keys.
 */
exports.saveAISettings = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { provider, apiKeys, model, temperature, maxTokens, contextWindow, systemPrompt } = data

  const allowed = ['claude', 'openai', 'gemini']
  if (provider && !allowed.includes(provider)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid provider.')
  }

  const update = {}
  if (provider)      update.provider      = provider
  if (apiKeys)       update.apiKeys       = apiKeys       // { claude: 'sk-ant-...', openai: 'sk-...', gemini: 'AIza...' }
  if (model)         update.model         = model
  if (temperature)   update.temperature   = temperature
  if (maxTokens)     update.maxTokens     = maxTokens
  if (contextWindow) update.contextWindow = contextWindow
  if (systemPrompt)  update.systemPrompt  = systemPrompt

  update.updatedAt = admin.firestore.FieldValue.serverTimestamp()
  update.updatedBy = context.auth.uid

  await db.collection('settings').doc('ai').set(update, { merge: true })
  return { success: true }
})

