import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, serverTimestamp, onSnapshot,
  deleteDoc, doc, updateDoc, query, where
} from 'firebase/firestore'
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
  const [participantCounts, setParticipantCounts] = useState({})
  const [creating, setCreating] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'sessions'), where('instructorId', '==', user.uid))
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (sessions.length === 0) return
    const unsubs = sessions.map(s =>
      onSnapshot(collection(db, 'sessions', s.id, 'participants'), snap => {
        setParticipantCounts(prev => ({ ...prev, [s.id]: snap.size }))
      })
    )
    return () => unsubs.forEach(u => u())
  }, [sessions])

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

  async function saveEdit() {
    if (!editingSession) return
    await updateDoc(doc(db, 'sessions', editingSession.id), {
      phaseConfig: config.phaseConfig,
      aiConfig: config.aiConfig,
    })
    setEditingSession(null)
    setConfig(DEFAULT_CONFIG)
  }

  function startEdit(session) {
    setEditingSession(session)
    setConfig({ phaseConfig: session.phaseConfig, aiConfig: session.aiConfig })
  }

  function cancelEdit() {
    setEditingSession(null)
    setConfig(DEFAULT_CONFIG)
  }

  async function deleteSession(sessionId) {
    await deleteDoc(doc(db, 'sessions', sessionId))
    setDeleteConfirm(null)
  }

  const pc = config.phaseConfig
  const ac = config.aiConfig
  const bothActive = pc.individualPhaseActive && pc.groupPhaseActive

  const activeSessions = sessions
    .filter(s => !['done', 'survey'].includes(s.status))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))

  const completedSessions = sessions
    .filter(s => ['done', 'survey'].includes(s.status))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))

  const phases = []
  if (pc.individualPhaseActive) phases.push('Individual')
  if (pc.groupPhaseActive) phases.push('Group')
  const phaseStr = pc.phaseOrder === 'group_first' ? [...phases].reverse().join(' → ') : phases.join(' → ')
  const timers = [
    pc.individualPhaseActive && pc.individualPhaseDuration && `${Math.round(pc.individualPhaseDuration / 60)}min individual`,
    pc.groupPhaseActive && pc.groupPhaseDuration && `${Math.round(pc.groupPhaseDuration / 60)}min group`,
    pc.groupPhaseActive && pc.votingDuration && `${Math.round(pc.votingDuration / 60)}min voting`,
  ].filter(Boolean)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.headerRight}>
          <span className={styles.role}>Instructor</span>
          <button className="btn-ghost" onClick={() => navigate('/admin/ai-settings')}>AI Settings</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.columns}>
          <div className={styles.leftCol}>
            <div className="card">
              <h2 className={styles.cardTitle}>
                {editingSession ? `Edit Session — ${editingSession.code}` : 'Create New Session'}
                {editingSession && <span className={styles.editBadge}>editing</span>}
              </h2>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Phases</h3>
                <div className={styles.grid2}>
                  <Toggle label="Individual Phase" checked={pc.individualPhaseActive} onChange={v => setPhase('individualPhaseActive', v)} />
                  <Toggle label="Group Phase" checked={pc.groupPhaseActive} onChange={v => setPhase('groupPhaseActive', v)} />
                </div>
                {bothActive && (
                  <div className={styles.field}>
                    <label className={styles.label}>Phase Order</label>
                    <select className="input-field" value={pc.phaseOrder} onChange={e => setPhase('phaseOrder', e.target.value)}>
                      <option value="individual_first">Individual first, then Group</option>
                      <option value="group_first">Group first, then Individual</option>
                    </select>
                  </div>
                )}
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Idea Parameters</h3>
                <div className={styles.grid2}>
                  <NumberField label="Max ideas (individual)" value={pc.maxIdeasIndividual} min={1} max={20} onChange={v => setPhase('maxIdeasIndividual', v)} disabled={!pc.individualPhaseActive} />
                  <NumberField label="Ideas carried to group" value={pc.ideasCarriedToGroup} min={1} max={pc.maxIdeasIndividual} onChange={v => setPhase('ideasCarriedToGroup', v)} disabled={!pc.individualPhaseActive || !pc.groupPhaseActive} />
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Phase Timers (seconds, blank = manual)</h3>
                <div className={styles.grid3}>
                  <NumberField label="Individual" value={pc.individualPhaseDuration} min={60} onChange={v => setPhase('individualPhaseDuration', v)} disabled={!pc.individualPhaseActive} nullable />
                  <NumberField label="Group" value={pc.groupPhaseDuration} min={60} onChange={v => setPhase('groupPhaseDuration', v)} disabled={!pc.groupPhaseActive} nullable />
                  <NumberField label="Voting" value={pc.votingDuration} min={30} onChange={v => setPhase('votingDuration', v)} disabled={!pc.groupPhaseActive} nullable />
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>AI Assistant</h3>
                <div className={styles.grid2}>
                  <Toggle label="AI in Individual Phase" checked={ac.individualAI} onChange={v => setAI('individualAI', v)} disabled={!pc.individualPhaseActive} />
                  <Toggle label="AI in Group Phase" checked={ac.groupAI} onChange={v => setAI('groupAI', v)} disabled={!pc.groupPhaseActive} />
                </div>
              </div>

              <div className={styles.summary}>
                <h3 className={styles.summaryTitle}>Setup Summary</h3>
                <div className={styles.summaryGrid}>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Phases</span>
                    <span className={styles.summaryValue}>{phaseStr || 'None selected'}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Timers</span>
                    <span className={styles.summaryValue}>{timers.length ? timers.join(', ') : 'Manual only'}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Ideas</span>
                    <span className={styles.summaryValue}>Max {pc.maxIdeasIndividual}, carry {pc.ideasCarriedToGroup} to group</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>AI</span>
                    <span className={styles.summaryValue}>Individual: {ac.individualAI ? 'On' : 'Off'} / Group: {ac.groupAI ? 'On' : 'Off'}</span>
                  </div>
                </div>
              </div>

              <div className={styles.formActions}>
                {editingSession ? (
                  <>
                    <button className="btn-primary" onClick={saveEdit}>Save Changes</button>
                    <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={createSession} disabled={creating || (!pc.individualPhaseActive && !pc.groupPhaseActive)}>
                    {creating ? 'Creating...' : 'Create Session'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.rightCol}>
            <div className="card">
              <h2 className={styles.cardTitle}>
                Active Sessions
                <span className={styles.countBadge}>{activeSessions.length} active</span>
              </h2>
              {activeSessions.length === 0 ? (
                <div className={styles.empty}>No active sessions. Create one to get started.</div>
              ) : (
                <div className={styles.sessionList}>
                  {activeSessions.map(s => (
                    <SessionCard key={s.id} session={s} participantCount={participantCounts[s.id] || 0}
                      onOpen={() => navigate(`/admin/session/${s.id}`)}
                      onEdit={() => startEdit(s)}
                      onDelete={() => setDeleteConfirm(s.id)}
                      canEdit={s.status === 'waiting'} />
                  ))}
                </div>
              )}
            </div>

            {completedSessions.length > 0 && (
              <div className="card" style={{ marginTop: 20 }}>
                <h2 className={styles.cardTitle}>
                  Completed Sessions
                  <span className={styles.countBadge}>{completedSessions.length} total</span>
                </h2>
                <div className={styles.sessionList}>
                  {completedSessions.map(s => (
                    <SessionCard key={s.id} session={s} participantCount={participantCounts[s.id] || 0}
                      onOpen={() => navigate(`/admin/session/${s.id}`)}
                      onDelete={() => setDeleteConfirm(s.id)}
                      canEdit={false} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {deleteConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete Session?</h3>
            <p className={styles.modalDesc}>This permanently deletes the session and all its data. Cannot be undone.</p>
            <div className={styles.modalActions}>
              <button className="btn-primary" style={{ background: '#c0392b' }} onClick={() => deleteSession(deleteConfirm)}>Delete permanently</button>
              <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, participantCount, onOpen, onEdit, onDelete, canEdit }) {
  const pc = session.phaseConfig || {}
  const phases = [pc.individualPhaseActive && 'Individual', pc.groupPhaseActive && 'Group'].filter(Boolean).join(' + ')
  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionCardTop}>
        <div className={styles.sessionCardLeft}>
          <span className={styles.sessionCode}>{session.code}</span>
          <span className={`${styles.statusBadge} ${styles['status_' + session.status]}`}>{session.status}</span>
        </div>
        <div className={styles.sessionCardRight}>
          <span className={styles.participantCount}>{participantCount} participants</span>
          <span className={styles.phasesMeta}>{phases}</span>
        </div>
      </div>
      <div className={styles.sessionCardActions}>
        <button className="btn-primary" style={{ padding: '6px 18px', fontSize: 13 }} onClick={onOpen}>Open</button>
        {canEdit && <button className="btn-ghost" style={{ padding: '6px 18px', fontSize: 13 }} onClick={onEdit}>Edit</button>}
        <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ''}`}>
      <span className={styles.toggleLabel}>{label}</span>
      <div className={`${styles.toggleTrack} ${checked && !disabled ? styles.toggleOn : ''}`} onClick={() => !disabled && onChange(!checked)}>
        <div className={styles.toggleThumb} />
      </div>
    </label>
  )
}

function NumberField({ label, value, min, max, onChange, disabled, nullable }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className="input-field" type="number" value={value ?? ''} min={min} max={max} disabled={disabled}
        onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value))} />
    </div>
  )
}