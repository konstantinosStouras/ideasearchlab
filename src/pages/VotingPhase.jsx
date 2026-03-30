import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  collection, onSnapshot, query, where, doc,
  updateDoc, serverTimestamp, getDocs
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import PhaseTimer from '../components/PhaseTimer'
import styles from './VotingPhase.module.css'

const MAX_VOTES = 3

export default function VotingPhase() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const [groupId, setGroupId] = useState(null)
  const [ideas, setIdeas] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const pc = session?.phaseConfig || {}

  // Get groupId
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => { if (snap.exists()) setGroupId(snap.data().groupId) }
    )
    return unsub
  }, [sessionId, user])

  // Load all ideas for this group
  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // Individual ideas from group members + group ideas
        // We need member IDs — load via group doc or participant query
        setIdeas(all.filter(i =>
          i.groupId === groupId ||
          (i.phase === 'individual') // filtered further once we have member list
        ))
      }
    )
    return unsub
  }, [sessionId, groupId])

  // Proper idea pool: fetch group members then filter
  useEffect(() => {
    if (!sessionId || !groupId) return
    const pc2 = session?.phaseConfig || {}
    const ideasCarried = pc2.ideasCarriedToGroup || 3

    const memberUnsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'participants'), where('groupId', '==', groupId)),
      memberSnap => {
        const memberIds = memberSnap.docs.map(d => d.id)
        const ideaUnsub = onSnapshot(
          collection(db, 'sessions', sessionId, 'ideas'),
          snap => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            const indivIdeas = memberIds.flatMap(uid => {
              const mine = all
                .filter(i => i.authorId === uid && i.phase === 'individual')
                .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
              return mine.slice(-ideasCarried)
            })
            const groupIdeas = all.filter(i => i.phase === 'group' && i.groupId === groupId)
            setIdeas([...indivIdeas, ...groupIdeas])
          }
        )
        return ideaUnsub
      }
    )
    return memberUnsub
  }, [sessionId, groupId, session])

  function toggleVote(ideaId) {
    if (submitted) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else if (next.size < MAX_VOTES) {
        next.add(ideaId)
      }
      return next
    })
  }

  async function submitVotes() {
    if (selected.size !== MAX_VOTES || submitting || submitted) return
    setSubmitting(true)
    try {
      // Record votes on each idea
      for (const ideaId of selected) {
        const ideaRef = doc(db, 'sessions', sessionId, 'ideas', ideaId)
        const snap = await getDocs(query(collection(db, 'sessions', sessionId, 'ideas'), where('__name__', '==', ideaId)))
        // Simple: just mark in participant doc which ideas they voted for
      }

      // Mark participant as done with voting
      await updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), {
        status: 'survey',
        votedFor: Array.from(selected),
        votedAt: serverTimestamp(),
      })

      setSubmitted(true)
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const individualIdeas = ideas.filter(i => i.phase === 'individual')
  const groupIdeas = ideas.filter(i => i.phase === 'group')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Vote for the Best Ideas</h1>
          <p className={styles.sub}>Select exactly {MAX_VOTES} ideas your group wants to submit.</p>
        </div>
        <div className={styles.headerRight}>
          <PhaseTimer
            phaseStartedAt={session?.phaseStartedAt}
            durationSeconds={pc.votingDuration}
            onExpire={selected.size === MAX_VOTES && !submitted ? submitVotes : undefined}
          />
          <div className={styles.voteCount}>
            <span className={styles.voteNum}>{selected.size}</span>
            <span className={styles.voteDen}> / {MAX_VOTES}</span>
          </div>
        </div>
      </div>

      {submitted ? (
        <div className={styles.doneMsg}>
          Votes submitted. Waiting for the survey to begin.
        </div>
      ) : (
        <>
          <div className={styles.sections}>
            {individualIdeas.length > 0 && (
              <section>
                <h2 className={styles.sectionTitle}>Individual Ideas</h2>
                <div className={styles.grid}>
                  {individualIdeas.map(idea => (
                    <IdeaVoteCard
                      key={idea.id}
                      idea={idea}
                      selected={selected.has(idea.id)}
                      disabled={!selected.has(idea.id) && selected.size >= MAX_VOTES}
                      onToggle={() => toggleVote(idea.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {groupIdeas.length > 0 && (
              <section>
                <h2 className={styles.sectionTitle}>Group Ideas</h2>
                <div className={styles.grid}>
                  {groupIdeas.map(idea => (
                    <IdeaVoteCard
                      key={idea.id}
                      idea={idea}
                      selected={selected.has(idea.id)}
                      disabled={!selected.has(idea.id) && selected.size >= MAX_VOTES}
                      onToggle={() => toggleVote(idea.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className={styles.footer}>
            <button
              className="btn-primary"
              onClick={submitVotes}
              disabled={selected.size !== MAX_VOTES || submitting}
            >
              {submitting ? 'Submitting...' : `Submit ${MAX_VOTES} Votes`}
            </button>
            {selected.size < MAX_VOTES && (
              <span className={styles.footerHint}>Select {MAX_VOTES - selected.size} more</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function IdeaVoteCard({ idea, selected, disabled, onToggle }) {
  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${disabled ? styles.cardDisabled : ''}`}
      onClick={disabled ? undefined : onToggle}
    >
      {selected && <div className={styles.checkmark}>✓</div>}
      <span className={styles.phase}>{idea.phase}</span>
      <p className={styles.ideaText}>{idea.text}</p>
      <span className={styles.author}>{idea.authorName?.split(' ')[0]}</span>
    </div>
  )
}
