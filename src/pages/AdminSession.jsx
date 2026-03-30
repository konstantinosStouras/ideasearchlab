import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  doc, collection, onSnapshot, updateDoc, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { getPhaseSequence } from '../utils/phaseSequence'
import styles from './AdminSession.module.css'

export default function AdminSession() {
  const { sessionId } = useParams()
  const [session, setSession] = useState(null)
  const [participants, setParticipants] = useState([])
  const [advancing, setAdvancing] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) setSession({ id: snap.id, ...snap.data() })
    })
    return unsub
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'participants'),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  async function advancePhase() {
    if (!session) return
    setAdvancing(true)
    try {
      const sequence = getPhaseSequence(session.phaseConfig)
      const currentIndex = sequence.indexOf(session.status)
      const nextPhase = sequence[currentIndex + 1]
      if (!nextPhase) return

      const updates = {
        status: nextPhase,
        phaseStartedAt: serverTimestamp(),
      }

      // When advancing to individual or group, update all waiting participants
      if (nextPhase === 'individual') {
        // Cloud function handles participant status - just update session
      }

      await updateDoc(doc(db, 'sessions', sessionId), updates)
    } finally {
      setAdvancing(false)
    }
  }

  if (!session) return <div className={styles.loading}>Loading...</div>

  const sequence = getPhaseSequence(session.phaseConfig)
  const currentIndex = sequence.indexOf(session.status)
  const nextPhase = sequence[currentIndex + 1]
  const isLast = !nextPhase || nextPhase === 'done'

  const byStatus = participants.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <span className={styles.slash}>/</span>
          <span className={styles.sessionCode}>{session.code}</span>
        </div>
        <span className={`${styles.statusBadge} ${styles['status_' + session.status]}`}>
          {session.status}
        </span>
      </header>

      <main className={styles.main}>
        {/* Phase timeline */}
        <div className={styles.timeline}>
          {sequence.map((phase, i) => (
            <div
              key={phase}
              className={`${styles.timelineStep} ${i < currentIndex ? styles.done : ''} ${i === currentIndex ? styles.active : ''}`}
            >
              <div className={styles.timelineDot} />
              <span className={styles.timelineLabel}>{phase}</span>
            </div>
          ))}
        </div>

        <div className={styles.grid}>
          {/* Participant breakdown */}
          <div className="card">
            <h2 className={styles.cardTitle}>Participants ({participants.length})</h2>
            <div className={styles.breakdown}>
              {Object.entries(byStatus).map(([status, count]) => (
                <div key={status} className={styles.breakdownRow}>
                  <span className={styles.breakdownStatus}>{status}</span>
                  <span className={styles.breakdownCount}>{count}</span>
                </div>
              ))}
            </div>
            <div className={styles.participantList}>
              {participants.map(p => (
                <div key={p.id} className={styles.participantRow}>
                  <span>{p.name}</span>
                  <span className={styles.pStatus}>{p.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Session config summary */}
          <div className="card">
            <h2 className={styles.cardTitle}>Session Config</h2>
            <div className={styles.configList}>
              <ConfigRow label="Individual Phase" value={session.phaseConfig?.individualPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Group Phase" value={session.phaseConfig?.groupPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Phase Order" value={session.phaseConfig?.phaseOrder || 'N/A'} />
              <ConfigRow label="Max ideas (individual)" value={session.phaseConfig?.maxIdeasIndividual} />
              <ConfigRow label="Ideas to group" value={session.phaseConfig?.ideasCarriedToGroup} />
              <ConfigRow label="AI (individual)" value={session.aiConfig?.individualAI ? 'On' : 'Off'} />
              <ConfigRow label="AI (group)" value={session.aiConfig?.groupAI ? 'On' : 'Off'} />
            </div>
          </div>
        </div>

        {/* Advance control */}
        {session.status !== 'done' && (
          <div className={styles.advanceBar}>
            <div className={styles.advanceInfo}>
              <span className={styles.advanceLabel}>Current phase:</span>
              <strong>{session.status}</strong>
              {nextPhase && (
                <>
                  <span className={styles.advanceArrow}>→</span>
                  <span className={styles.advanceNext}>{nextPhase}</span>
                </>
              )}
            </div>
            <button
              className="btn-primary"
              onClick={advancePhase}
              disabled={advancing || isLast}
            >
              {advancing ? 'Advancing...' : isLast ? 'Session Complete' : `Advance to: ${nextPhase}`}
            </button>
          </div>
        )}

        {session.status === 'done' && (
          <div className={styles.doneBar}>Session complete. All participants have finished.</div>
        )}
      </main>
    </div>
  )
}

function ConfigRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  )
}
