import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { db, functions } from '../firebase'
import styles from './AISettings.module.css'

const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-4-20250514',
    ],
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    keyLabel: 'API Key',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    models: [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash',
    ],
  },
]

export default function AISettings() {
  const [current, setCurrent] = useState(null)
  const [provider, setProvider] = useState('claude')
  const [apiKeys, setApiKeys] = useState({ claude: '', openai: '', gemini: '' })
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(1.0)
  const [maxTokens, setMaxTokens] = useState(1000)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Load current settings from Firestore
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'ai'), snap => {
      if (snap.exists()) {
        const data = snap.data()
        setCurrent(data)
        if (data.provider)     setProvider(data.provider)
        if (data.apiKeys)      setApiKeys(k => ({ ...k, ...data.apiKeys }))
        if (data.model)        setModel(data.model)
        if (data.temperature)  setTemperature(data.temperature)
        if (data.maxTokens)    setMaxTokens(data.maxTokens)
        if (data.systemPrompt) setSystemPrompt(data.systemPrompt)
      }
    })
    return unsub
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const save = httpsCallable(functions, 'saveAISettings')
      await save({
        provider,
        apiKeys,
        model: model || null,
        temperature,
        maxTokens,
        systemPrompt: systemPrompt || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const activeProvider = PROVIDERS.find(p => p.id === provider)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>AI Settings</h1>
        <p className={styles.sub}>
          Configure which LLM provider powers the AI assistant across all sessions.
          API keys are stored securely in Firestore and never exposed to participants.
        </p>
      </div>

      <form onSubmit={handleSave} className={styles.form}>

        {/* Provider selector */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Provider</h2>
          <div className={styles.providerGrid}>
            {PROVIDERS.map(p => (
              <div
                key={p.id}
                className={`${styles.providerCard} ${provider === p.id ? styles.providerActive : ''}`}
                onClick={() => { setProvider(p.id); setModel('') }}
              >
                <span className={styles.providerName}>{p.name}</span>
                {apiKeys[p.id] ? (
                  <span className={styles.keySet}>key set</span>
                ) : (
                  <span className={styles.keyMissing}>no key</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* API Keys - one field per provider */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>API Keys</h2>
          <p className={styles.hint}>
            You can store keys for multiple providers. Only the active provider's key is used.
          </p>
          {PROVIDERS.map(p => (
            <div key={p.id} className={styles.field}>
              <label className={styles.label}>
                {p.name}
                <a href={p.keyLink} target="_blank" rel="noopener noreferrer" className={styles.keyLink}>
                  Get key →
                </a>
              </label>
              <input
                className="input-field"
                type="password"
                value={apiKeys[p.id] || ''}
                onChange={e => setApiKeys(k => ({ ...k, [p.id]: e.target.value }))}
                placeholder={p.keyPlaceholder}
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        {/* Model */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Model</h2>
          <div className={styles.field}>
            <label className={styles.label}>Model for {activeProvider?.name}</label>
            <select
              className="input-field"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              <option value="">Use default</option>
              {activeProvider?.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Advanced parameters */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Parameters</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Temperature (0 = deterministic, 2 = creative)</label>
              <input
                className="input-field"
                type="number"
                min="0" max="2" step="0.1"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Max tokens per response</label>
              <input
                className="input-field"
                type="number"
                min="100" max="4000" step="100"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* System prompt override */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>System Prompt Override</h2>
          <p className={styles.hint}>
            Leave blank to use the built-in phase-specific prompts (recommended).
            Fill in to override with a custom prompt for all phases.
          </p>
          <textarea
            className={`input-field ${styles.promptArea}`}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Leave blank to use default phase prompts..."
            rows={6}
          />
        </div>

        {error && <p className="error-msg">{error}</p>}

        <button
          className={`btn-primary ${styles.saveBtn}`}
          type="submit"
          disabled={saving}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}
