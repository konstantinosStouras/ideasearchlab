import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import styles from './Admin.module.css'

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

const DEFAULT_CONFIG = {
  phaseConfig: {
    individualPhaseActive: true,
    groupPhaseActive: true,
    phaseOrder: 'individual_first',
    maxIdeasIndividual: 5,
    ideasCarriedToGroup: 3,
    individualPhaseDuration: 600,
    groupPhaseDuration: 900,
    votingDuration: 300,
  },
  aiConfig: {
    individualAI: false,
    groupAI: false,
    model: 'claude-sonnet-4-20250514',
    temperature: null,
    maxTokens: null,
    systemPrompt: null,
    personality: null,
    contextWindow: null,
  },
}

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [creating, setCreating] = useState(false)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [showForm, setShowForm] = useState(false)

  // Load instructor's sessions
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'sessions'), where('instructorId', '==', user.uid))
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [user])

  function setPhase(key, value) {
    setConfig(c => ({ ...c, phaseConfig: { ...c.phaseConfig, [key]: value } }))
  }

  function setAI(key, value) {
    setConfig(c => ({ ...c, aiConfig: { ...c.aiConfig, [key]: value } }))
  }

  async function createSession() {
    setCreating(true)
    try {
      const code = generateCode()
      const docRef = await addDoc(collection(db, 'sessions'), {
        code,
        instructorId: user.uid,
        instructorName: user.displayName || user.email,
        status: 'waiting',
        createdAt: serverTimestamp(),
        ...config,
      })
      navigate(`/admin/session/${docRef.id}`)
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  const pc = config.phaseConfig
  const ac = config.aiConfig
  const bothActive = pc.individualPhaseActive && pc.groupPhaseActive

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.headerRight}>
          <span className={styles.role}>Instructor</span>
          <span className={styles.userName}>{user?.displayName || user?.email}</span>
          <button className="btn-ghost" onClick={() => navigate('/admin/ai-settings')}>AI Settings</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.topBar}>
          <h1 className={styles.pageTitle}>Sessions</h1>
          <button className="btn-primary" onClick={() => setShowForm(f => !f)}>
            {showForm ? 'Cancel' : '+ New Session'}
          </button>
        </div>

        {showForm && (
          <div className={`card ${styles.formCard}`}>
            <h2 className={styles.sectionTitle}>Configure New Session</h2>

            {/* Phase toggles */}
            <div className={styles.section}>
              <h3 className={styles.subTitle}>Phases</h3>
              <div className={styles.grid2}>
                <Toggle
                  label="Individual Phase"
                  checked={pc.individualPhaseActive}
                  onChange={v => setPhase('individualPhaseActive', v)}
                />
                <Toggle
                  label="Group Phase"
                  checked={pc.groupPhaseActive}
                  onChange={v => setPhase('groupPhaseActive', v)}
                />
              </div>

              {bothActive && (
                <div className={styles.field}>
                  <label className={styles.label}>Phase Order</label>
                  <select
                    className="input-field"
                    value={pc.phaseOrder}
                    onChange={e => setPhase('phaseOrder', e.target.value)}
                  >
                    <option value="individual_first">Individual first, then Group</option>
                    <option value="group_first">Group first, then Individual</option>
                  </select>
                </div>
              )}
            </div>

            {/* Idea counts */}
            <div className={styles.section}>
              <h3 className={styles.subTitle}>Idea Parameters</h3>
              <div className={styles.grid2}>
                <NumberField
                  label="Max ideas per person (individual)"
                  value={pc.maxIdeasIndividual}
                  min={1} max={20}
                  onChange={v => setPhase('maxIdeasIndividual', v)}
                  disabled={!pc.individualPhaseActive}
                />
                <NumberField
                  label="Ideas each member carries to group"
                  value={pc.ideasCarriedToGroup}
                  min={1} max={pc.maxIdeasIndividual}
                  onChange={v => setPhase('ideasCarriedToGroup', v)}
                  disabled={!pc.individualPhaseActive || !pc.groupPhaseActive}
                />
              </div>
            </div>

            {/* Timers */}
            <div className={styles.section}>
              <h3 className={styles.subTitle}>Phase Timers (seconds, blank = manual)</h3>
              <div className={styles.grid3}>
                <NumberField
                  label="Individual phase"
                  value={pc.individualPhaseDuration}
                  min={60}
                  onChange={v => setPhase('individualPhaseDuration', v)}
                  disabled={!pc.individualPhaseActive}
                  nullable
                />
                <NumberField
                  label="Group phase"
                  value={pc.groupPhaseDuration}
                  min={60}
                  onChange={v => setPhase('groupPhaseDuration', v)}
                  disabled={!pc.groupPhaseActive}
                  nullable
                />
                <NumberField
                  label="Voting"
                  value={pc.votingDuration}
                  min={30}
                  onChange={v => setPhase('votingDuration', v)}
                  disabled={!pc.groupPhaseActive}
                  nullable
                />
              </div>
            </div>

            {/* AI config */}
            <div className={styles.section}>
              <h3 className={styles.subTitle}>AI Assistant</h3>
              <div className={styles.grid2}>
                <Toggle
                  label="AI in Individual Phase"
                  checked={ac.individualAI}
                  onChange={v => setAI('individualAI', v)}
                  disabled={!pc.individualPhaseActive}
                />
                <Toggle
                  label="AI in Group Phase"
                  checked={ac.groupAI}
                  onChange={v => setAI('groupAI', v)}
                  disabled={!pc.groupPhaseActive}
                />
              </div>
            </div>

            <button
              className={`btn-primary ${styles.createBtn}`}
              onClick={createSession}
              disabled={creating || (!pc.individualPhaseActive && !pc.groupPhaseActive)}
            >
              {creating ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        )}

        {/* Sessions list */}
        <div className={styles.sessionList}>
          {sessions.length === 0 && !showForm && (
            <div className={styles.empty}>No sessions yet. Create your first one.</div>
          )}
          {sessions
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
            .map(s => (
              <div
                key={s.id}
                className={styles.sessionRow}
                onClick={() => navigate(`/admin/session/${s.id}`)}
              >
                <div className={styles.sessionLeft}>
                  <span className={styles.sessionCode}>{s.code}</span>
                  <span className={`${styles.statusBadge} ${styles['status_' + s.status]}`}>
                    {s.status}
                  </span>
                </div>
                <div className={styles.sessionRight}>
                  <span className={styles.sessionMeta}>
                    {s.phaseConfig?.individualPhaseActive ? 'Individual' : ''}
                    {s.phaseConfig?.individualPhaseActive && s.phaseConfig?.groupPhaseActive ? ' + ' : ''}
                    {s.phaseConfig?.groupPhaseActive ? 'Group' : ''}
                  </span>
                  <span className={styles.sessionArrow}>→</span>
                </div>
              </div>
            ))}
        </div>
      </main>
    </div>
  )
}

// Small reusable form controls

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ''}`}>
      <span className={styles.toggleLabel}>{label}</span>
      <div
        className={`${styles.toggleTrack} ${checked && !disabled ? styles.toggleOn : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <div className={styles.toggleThumb} />
      </div>
    </label>
  )
}

function NumberField({ label, value, min, max, onChange, disabled, nullable }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input
        className="input-field"
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value === '' ? null : parseInt(e.target.value)
          onChange(v)
        }}
      />
    </div>
  )
}
