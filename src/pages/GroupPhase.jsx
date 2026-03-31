import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  serverTimestamp, doc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import styles from './GroupPhase.module.css'

export default function GroupPhase() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const navigate = useNavigate()
  const [groupId, setGroupId] = useState(null)
  const [memberLabels, setMemberLabels] = useState({})
  const [members, setMembers] = useState([])
  const [ideas, setIdeas] = useState([])
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pc = session?.phaseConfig || {}
  const aiEnabled = session?.aiConfig?.groupAI
  const ideasCarried = pc.ideasCarriedToGroup || 3

  // Get groupId, anonymous labels, and react to status changes
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        const status = data.status
        if (status === 'voting') navigate(`/session/${sessionId}/voting`)
        else if (status === 'survey') navigate(`/session/${sessionId}/survey`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // Load member labels from group document
  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'groups', groupId),
      snap => {
        if (snap.exists()) setMemberLabels(snap.data().memberLabels || {})
      }
    )
    return unsub
  }, [sessionId, groupId])

  // Listen to group members
  useEffect(() => {
    if (!sessionId || !groupId) return
    const q = query(
      collection(db, 'sessions', sessionId, 'participants'),
      where('groupId', '==', groupId)
    )
    const unsub = onSnapshot(q, snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, groupId])

  // Listen to all ideas for this group
  useEffect(() => {
    if (!sessionId || !groupId || members.length === 0) return
    const memberIds = members.map(m => m.id)

    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // Individual ideas: prefer selected ideas, fall back to latest N
        const individualIdeas = memberIds.flatMap(uid => {
          const mine = all.filter(i => i.authorId === uid && i.phase === 'individual')
          const selected = mine.filter(i => i.selected)
          if (selected.length > 0) return selected
          // Fallback: take latest N if selection flags weren't persisted
          const sorted = [...mine].sort(
            (a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
          )
          return sorted.slice(-ideasCarried)
        })

        // Group ideas: created during group phase for this group
        const groupIdeas = all.filter(i => i.phase === 'group' && i.groupId === groupId)

        setIdeas({ individual: individualIdeas, group: groupIdeas })
      }
    )
    return unsub
  }, [sessionId, groupId, members])

  async function submitGroupIdea(e) {
    e.preventDefault()
    const t = newTitle.trim()
    const d = newDesc.trim()
    if (!t || !d || submitting || !groupId) return

    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'group',
        groupId,
        votes: 0,
        createdAt: serverTimestamp(),
      })
      setNewTitle('')
      setNewDesc('')
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  /** Renders one idea pill card */
  function IdeaPill({ idea, variant }) {
    const label = memberLabels[idea.authorId] || idea.anonymousLabel || '?'
    const isMe = idea.authorId === user.uid
    return (
      <div className={`${styles.ideaPill} ${variant === 'group' ? styles.ideaPillGroup : ''}`}>
        <div className={styles.pillTop}>
          <div className={styles.pillMeta}>
            <span className={styles.pillAuthor}>{label}</span>
            {isMe && <span className={styles.youTag}>you</span>}
          </div>
        </div>
        <h4 className={styles.pillTitle}>{idea.title || idea.text}</h4>
        {idea.description && (
          <>
            <div className={styles.pillDivider} />
            <p className={styles.pillDesc}>{idea.description}</p>
          </>
        )}
      </div>
    )
  }

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Group Phase</h1>
          <div className={styles.memberPills}>
            {members.map(m => (
              <span key={m.id} className={`${styles.memberChip} ${m.id === user.uid ? styles.memberChipMe : ''}`}>
                {memberLabels[m.id] || m.anonymousLabel || 'Member'}
                {m.id === user.uid && ' (you)'}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.topRight}>
          <PhaseTimer
            phaseStartedAt={session?.phaseStartedAt}
            durationSeconds={pc.groupPhaseDuration}
          />
          <div className={styles.waitingMsg}>Waiting for instructor to advance to voting...</div>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Individual ideas column */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Individual Ideas</h2>
          <p className={styles.columnSub}>Selected ideas from each member</p>
          <div className={styles.ideaList}>
            {(ideas.individual || []).map(idea => (
              <IdeaPill key={idea.id} idea={idea} variant="individual" />
            ))}
          </div>
        </div>

        {/* Group ideas column */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Group Ideas</h2>
          <p className={styles.columnSub}>Generated together in this phase</p>
          <div className={styles.ideaList}>
            {(ideas.group || []).map(idea => (
              <IdeaPill key={idea.id} idea={idea} variant="group" />
            ))}

            <form onSubmit={submitGroupIdea} className={styles.addPill}>
              <input
                className={styles.addTitleInput}
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Idea title"
                disabled={submitting}
              />
              <div className={styles.addDivider} />
              <textarea
                className={styles.addDescInput}
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Description"
                rows={2}
                disabled={submitting}
              />
              <div className={styles.addFooter}>
                <button
                  className={`btn-primary ${styles.addBtn}`}
                  type="submit"
                  disabled={submitting || !newTitle.trim() || !newDesc.trim()}
                >
                  {submitting ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
            scope="group"
            scopeId={groupId}
            aiConfig={session?.aiConfig}
          />
        ) : null}
        defaultSplit={58}
      />
    </div>
  )
}