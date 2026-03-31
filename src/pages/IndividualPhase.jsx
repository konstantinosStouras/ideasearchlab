import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import styles from './IndividualPhase.module.css'

export default function IndividualPhase() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { session } = useSession()
  const [ideas, setIdeas] = useState([])
  const [newIdea, setNewIdea] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [groupMembers, setGroupMembers] = useState([])
  const [groupId, setGroupId] = useState(null)

  const pc = session?.phaseConfig || {}
  const maxIdeas = pc.maxIdeasIndividual || 5
  const aiEnabled = session?.aiConfig?.individualAI

  // Listen to this user's ideas
  useEffect(() => {
    if (!sessionId || !user) return
    const q = query(
      collection(db, 'sessions', sessionId, 'ideas'),
      where('authorId', '==', user.uid),
      where('phase', '==', 'individual'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, user])

  // Get groupId from own participant doc + navigate on status change
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        const status = data.status
        if (status === 'group') navigate(`/session/${sessionId}/group`)
        else if (status === 'voting') navigate(`/session/${sessionId}/voting`)
        else if (status === 'survey') navigate(`/session/${sessionId}/survey`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // Listen to group members to show completion count
  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      query(
        collection(db, 'sessions', sessionId, 'participants'),
        where('groupId', '==', groupId)
      ),
      snap => setGroupMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId, groupId])

  async function submitIdea(e) {
    e.preventDefault()
    const text = newIdea.trim()
    if (!text || submitting || ideas.length >= maxIdeas) return

    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        text,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'individual',
        groupId: null,
        votes: 0,
        createdAt: serverTimestamp(),
      })
      setNewIdea('')
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  async function markDone() {
    if (done) return
    setDone(true)
    await updateDoc(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      { individualComplete: true, status: 'waiting_for_group' }
    )
  }

  const atMax = ideas.length >= maxIdeas
  const canFinish = ideas.length > 0 && !done

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Individual Phase</h1>
          <span className={styles.ideaCount}>{ideas.length} / {maxIdeas} ideas</span>
        </div>
        <div className={styles.topRight}>
          <PhaseTimer
            phaseStartedAt={session?.phaseStartedAt}
            durationSeconds={pc.individualPhaseDuration}
            onExpire={canFinish ? markDone : undefined}
          />
          <button
            className={`btn-primary ${styles.doneBtn}`}
            onClick={markDone}
            disabled={!canFinish}
          >
            {done ? 'Waiting for group...' : 'Finish & Submit'}
          </button>
        </div>
      </div>

      {done && (() => {
        const groupSize = session?.phaseConfig?.groupSize ?? 3
        const firestoreCount = groupMembers.filter(m => m.individualComplete).length
        const selfCounted = groupMembers.some(m => m.id === user?.uid && m.individualComplete)
        const doneCount = (done && !selfCounted) ? firestoreCount + 1 : firestoreCount
        return (
          <div className={styles.waitingBanner}>
            {groupSize === 1
              ? 'Your ideas are submitted. Proceeding to the next phase...'
              : `${doneCount} of ${groupSize} group members have submitted.`}
          </div>
        )
      })()}

      {/* Idea list */}
      <div className={styles.ideaList}>
        {ideas.map((idea, i) => (
          <div key={idea.id} className={styles.ideaCard}>
            <span className={styles.ideaNum}>{i + 1}</span>
            <p className={styles.ideaText}>{idea.text}</p>
          </div>
        ))}

        {!done && !atMax && (
          <form onSubmit={submitIdea} className={styles.addCard}>
            <textarea
              className={styles.ideaInput}
              value={newIdea}
              onChange={e => setNewIdea(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) submitIdea(e) }}
              placeholder={`Idea ${ideas.length + 1} — what's your idea?`}
              rows={3}
              disabled={submitting || done}
              autoFocus
            />
            <button
              className="btn-primary"
              type="submit"
              disabled={submitting || !newIdea.trim() || done}
            >
              {submitting ? 'Adding...' : 'Add Idea'}
            </button>
          </form>
        )}

        {atMax && !done && (
          <div className={styles.maxReached}>
            Maximum ideas reached. Review your ideas above and click Finish when ready.
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className={styles.page}>
      <SplitLayout
        leftPanel={mainPanel}
        rightPanel={aiEnabled ? (
          <AIChat
            sessionId={sessionId}
            scope="individual"
            scopeId={user?.uid}
            aiConfig={session?.aiConfig}
          />
        ) : null}
        defaultSplit={58}
      />
    </div>
  )
}