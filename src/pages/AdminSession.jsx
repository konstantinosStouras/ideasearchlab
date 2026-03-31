import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, collection, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { getPhaseSequence } from '../utils/phaseSequence'
import styles from './AdminSession.module.css'

export default function AdminSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
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
      await httpsCallable(functions, 'advancePhase')({ sessionId })
    } catch (err) {
      console.error('advancePhase error:', err)
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
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/admin')}>← Back</button>
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
        <div className={styles.timelineCard}>
          <div className={styles.timeline}>
            {sequence.map((phase, i) => (
              <div
                key={phase}
                className={[
                  styles.timelineStep,
                  i < currentIndex ? styles.done : '',
                  i === currentIndex ? styles.active : '',
                ].join(' ')}
              >
                <div className={styles.timelineDot} />
                <span className={styles.timelineLabel}>{phase}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Participant breakdown */}
          <div className="card">
            <h2 className={styles.cardTitle}>Participants <span className={styles.cardCount}>({participants.length})</span></h2>
            {participants.length === 0 ? (
              <p className={styles.emptyNote}>No participants have joined yet.</p>
            ) : (
              <>
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
                      <span>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                      <span className={styles.pStatus}>{p.status}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Session config summary */}
          <div className="card">
            <h2 className={styles.cardTitle}>Session Config</h2>
            <div className={styles.configList}>
              <ConfigRow label="Individual Phase" value={session.phaseConfig?.individualPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Group Phase" value={session.phaseConfig?.groupPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Phase Order" value={session.phaseConfig?.phaseOrder?.replace('_', ' ') || 'N/A'} />
              <ConfigRow label="Group size" value={session.phaseConfig?.groupSize ?? 'N/A'} />
              <ConfigRow label="Max ideas (individual)" value={session.phaseConfig?.maxIdeasIndividual ?? 'N/A'} />
              <ConfigRow label="Ideas carried to group" value={session.phaseConfig?.ideasCarriedToGroup ?? 'N/A'} />
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
            <div className={styles.advanceRight}>
              {['waiting', 'individual', 'group'].includes(session.status) && (
                <span className={styles.autoNote}>Auto-advances when participants complete</span>
              )}
              <button
                className="btn-primary"
                onClick={advancePhase}
                disabled={advancing || isLast}
              >
                {advancing ? 'Advancing...' : isLast ? 'Session Complete' : `Force advance → ${nextPhase}`}
              </button>
            </div>
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
    <div className={styles.configRow}>
      <span className={styles.configLabel}>{label}</span>
      <strong className={styles.configValue}>{String(value)}</strong>
    </div>
  )
}