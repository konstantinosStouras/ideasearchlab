import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc, getDoc
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
  const [groupId, setGroupId] = useState(null)
  const [members, setMembers] = useState([])
  const [ideas, setIdeas] = useState([])
  const [newIdea, setNewIdea] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pc = session?.phaseConfig || {}
  const aiEnabled = session?.aiConfig?.groupAI
  const ideasCarried = pc.ideasCarriedToGroup || 3

  // Get my groupId from participant doc
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => { if (snap.exists()) setGroupId(snap.data().groupId) }
    )
    return unsub
  }, [sessionId, user])

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

  // Listen to all ideas for this group (individual carried + new group ideas)
  useEffect(() => {
    if (!sessionId || !groupId || members.length === 0) return
    const memberIds = members.map(m => m.id)

    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // Individual ideas: from group members, sorted by createdAt, take latest N per person
        const individualIdeas = memberIds.flatMap(uid => {
          const mine = all
            .filter(i => i.authorId === uid && i.phase === 'individual')
            .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
          return mine.slice(-ideasCarried)
        })

        // Group ideas: created during group phase for this group
        const groupIdeas = all.filter(i => i.phase === 'group' && i.groupId === groupId)

        setIdeas({ individual: individualIdeas, group: groupIdeas })
      }
    )
    return unsub
  }, [sessionId, groupId, members, ideasCarried])

  async function submitGroupIdea(e) {
    e.preventDefault()
    const text = newIdea.trim()
    if (!text || submitting || !groupId) return

    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        text,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'group',
        groupId,
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

  async function proceedToVoting() {
    if (!groupId) return
    await updateDoc(doc(db, 'sessions', sessionId, 'groups', groupId), {
      status: 'voting'
    })
    // Update all group members' status to voting
    for (const m of members) {
      await updateDoc(doc(db, 'sessions', sessionId, 'participants', m.id), {
        status: 'voting'
      })
    }
  }

  const allIdeas = [...(ideas.individual || []), ...(ideas.group || [])]

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Group Phase</h1>
          <div className={styles.memberPills}>
            {members.map(m => (
              <span key={m.id} className={`${styles.pill} ${m.id === user.uid ? styles.pillMe : ''}`}>
                {m.name?.split(' ')[0] || 'Member'}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.topRight}>
          <PhaseTimer
            phaseStartedAt={session?.phaseStartedAt}
            durationSeconds={pc.groupPhaseDuration}
            onExpire={proceedToVoting}
          />
          <button className="btn-primary" onClick={proceedToVoting}>
            Proceed to Voting
          </button>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Individual ideas column */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Individual Ideas</h2>
          <p className={styles.columnSub}>Top {ideasCarried} from each member</p>
          <div className={styles.ideaList}>
            {(ideas.individual || []).map((idea, i) => {
              const author = members.find(m => m.id === idea.authorId)
              return (
                <div key={idea.id} className={styles.ideaCard}>
                  <div className={styles.ideaHeader}>
                    <span className={styles.ideaAuthor}>{author?.name?.split(' ')[0] || '?'}</span>
                    {idea.authorId === user.uid && <span className={styles.youTag}>you</span>}
                  </div>
                  <p className={styles.ideaText}>{idea.text}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Group ideas column */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Group Ideas</h2>
          <p className={styles.columnSub}>Generated together in this phase</p>
          <div className={styles.ideaList}>
            {(ideas.group || []).map(idea => (
              <div key={idea.id} className={`${styles.ideaCard} ${styles.groupCard}`}>
                <div className={styles.ideaHeader}>
                  <span className={styles.ideaAuthor}>{idea.authorName?.split(' ')[0]}</span>
                </div>
                <p className={styles.ideaText}>{idea.text}</p>
              </div>
            ))}

            <form onSubmit={submitGroupIdea} className={styles.addCard}>
              <textarea
                className={styles.ideaInput}
                value={newIdea}
                onChange={e => setNewIdea(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) submitGroupIdea(e) }}
                placeholder="Add a new group idea..."
                rows={2}
                disabled={submitting}
              />
              <button
                className="btn-primary"
                type="submit"
                disabled={submitting || !newIdea.trim()}
              >
                {submitting ? 'Adding...' : 'Add'}
              </button>
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
