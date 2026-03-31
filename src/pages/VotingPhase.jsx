import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { collection, onSnapshot, query, where, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
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
  const [memberIds, setMemberIds] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()
  const pc = session?.phaseConfig || {}

  // Get groupId and react to status changes
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        const status = data.status
        if (status === 'survey') {
          navigate(`/session/${sessionId}/survey`)
        } else if (status === 'done') {
          navigate(`/session/${sessionId}/done`)
        }
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // Load ideas for this group - members first, then ideas
  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'participants'), where('groupId', '==', groupId)),
      snap => setMemberIds(snap.docs.map(d => d.id))
    )
    return unsub
  }, [sessionId, groupId])

  useEffect(() => {
    if (!sessionId || !groupId || memberIds.length === 0) return
    const ideasCarried = session?.phaseConfig?.ideasCarriedToGroup || 3

    const unsub = onSnapshot(
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
    return unsub
  }, [sessionId, groupId, memberIds, session])

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
      await httpsCallable(functions, 'submitVote')({
        sessionId,
        ideaIds: Array.from(selected),
      })
      setSubmitted(true)
    } catch (err) {
      console.error('submitVote error:', err)
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