import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where, orderBy,
  serverTimestamp, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import styles from './GroupPhase.module.css'

const MAX_VOTES = 3

export default function GroupPhase() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const navigate = useNavigate()
  const [groupId, setGroupId] = useState(null)
  const [memberLabels, setMemberLabels] = useState({})
  const [members, setMembers] = useState([])
  const [ideas, setIdeas] = useState({ individual: [], group: [] })
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Sub-phase: 'ideation' or 'voting'
  const [subPhase, setSubPhase] = useState('ideation')
  const [votesLocked, setVotesLocked] = useState(false)

  // Chat state
  const [messages, setMessages] = useState([])
  const [chatText, setChatText] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const chatEndRef = useRef(null)

  const pc = session?.phaseConfig || {}
  const aiEnabled = session?.aiConfig?.groupAI
  const ideasCarried = pc.ideasCarriedToGroup || 3

  const isVoting = subPhase === 'voting'

  // ── Derive voting data from members ──────────────────
  const myVotes = (members.find(m => m.id === user?.uid)?.votedFor) || []
  const myVoteCount = myVotes.length

  const voteCounts = {}
  members.forEach(m => {
    (m.votedFor || []).forEach(id => {
      voteCounts[id] = (voteCounts[id] || 0) + 1
    })
  })

  // ── Get groupId and react to status changes ─────────
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        if (data.votesSubmitted) setVotesLocked(true)
        const status = data.status
        if (status === 'survey') navigate(`/session/${sessionId}/survey`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // ── Load member labels from group document ──────────
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

  // ── Listen to group members ─────────────────────────
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

  // ── Listen to all ideas for this group ──────────────
  useEffect(() => {
    if (!sessionId || !groupId || members.length === 0) return
    const memberIds = members.map(m => m.id)

    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        const individualIdeas = memberIds.flatMap(uid => {
          const mine = all.filter(i => i.authorId === uid && i.phase === 'individual')
          const selected = mine.filter(i => i.selected)
          if (selected.length > 0) return selected
          const sorted = [...mine].sort(
            (a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
          )
          return sorted.slice(-ideasCarried)
        })

        const groupIdeas = all.filter(i => i.phase === 'group' && i.groupId === groupId)

        setIdeas({ individual: individualIdeas, group: groupIdeas })
      }
    )
    return unsub
  }, [sessionId, groupId, members, ideasCarried])

  // ── Listen to chat messages ─────────────────────────
  useEffect(() => {
    if (!sessionId || !groupId) return
    const q = query(
      collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, groupId])

  // ── Auto-scroll chat on new messages ────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Toggle vote on double-click ─────────────────────
  const toggleVote = useCallback(async (ideaId) => {
    if (!isVoting || votesLocked || !sessionId || !user) return
    const isVoted = myVotes.includes(ideaId)
    let newVotes
    if (isVoted) {
      newVotes = myVotes.filter(id => id !== ideaId)
    } else {
      if (myVotes.length >= MAX_VOTES) return
      newVotes = [...myVotes, ideaId]
    }
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { votedFor: newVotes }
      )
    } catch (err) {
      console.error('Vote toggle error:', err)
    }
  }, [isVoting, votesLocked, sessionId, user, myVotes])

  // ── Submit / lock votes ─────────────────────────────
  async function submitVotes() {
    if (myVoteCount !== MAX_VOTES || votesLocked || !sessionId || !user) return
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { votesSubmitted: true, votedAt: serverTimestamp() }
      )
      setVotesLocked(true)
    } catch (err) {
      console.error('Submit votes error:', err)
    }
  }

  // ── Submit new group idea ───────────────────────────
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

  // ── Send chat message ───────────────────────────────
  async function sendChatMessage(e) {
    e.preventDefault()
    const text = chatText.trim()
    if (!text || sendingChat || !groupId) return

    setSendingChat(true)
    try {
      await addDoc(
        collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
        {
          text,
          authorId: user.uid,
          authorLabel: memberLabels[user.uid] || 'you',
          createdAt: serverTimestamp(),
        }
      )
      setChatText('')
    } catch (err) {
      console.error('Chat send error:', err)
    } finally {
      setSendingChat(false)
    }
  }

  // ── Sort helpers ────────────────────────────────────
  const sortByVotes = (a, b) => {
    const va = voteCounts[a.id] || 0
    const vb = voteCounts[b.id] || 0
    if (vb !== va) return vb - va
    return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
  }

  const sortByTime = (a, b) =>
    (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)

  const sortedIndividual = [...(ideas.individual || [])].sort(isVoting ? sortByVotes : sortByTime)
  const sortedGroup = [...(ideas.group || [])].sort(isVoting ? sortByVotes : sortByTime)

  // For voting mode: merge all ideas into one list sorted by votes
  const allIdeasForVoting = [...(ideas.individual || []), ...(ideas.group || [])].sort(sortByVotes)

  // ── Format timestamp for chat bubbles ───────────────
  function formatTime(timestamp) {
    if (!timestamp?.seconds) return ''
    const d = new Date(timestamp.seconds * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  /** Renders one idea pill card */
  function IdeaPill({ idea, variant }) {
    const label = memberLabels[idea.authorId] || idea.anonymousLabel || '?'
    const isMe = idea.authorId === user.uid
    const vc = voteCounts[idea.id] || 0
    const votedByMe = myVotes.includes(idea.id)
    const canVote = !votesLocked && (votedByMe || myVoteCount < MAX_VOTES)

    return (
      <div
        className={[
          styles.ideaPill,
          variant === 'group' ? styles.ideaPillGroup : '',
          isVoting && votedByMe ? styles.ideaPillVoted : '',
          isVoting && !canVote && !votedByMe ? styles.ideaPillMaxed : '',
          isVoting ? styles.ideaPillClickable : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={isVoting && canVote ? () => toggleVote(idea.id) : undefined}
        title={isVoting
          ? (votesLocked ? 'Votes locked' : votedByMe ? 'Double-click to remove vote' : canVote ? 'Double-click to vote' : 'Maximum votes reached')
          : undefined
        }
      >
        {isVoting && vc > 0 && (
          <div className={`${styles.voteBadge} ${votedByMe ? styles.voteBadgeMine : ''}`}>
            Votes: {vc}
          </div>
        )}
        <div className={styles.pillTop}>
          <div className={styles.pillMeta}>
            <span className={styles.pillAuthor}>{label}</span>
            {isMe && <span className={styles.youTag}>you</span>}
            {isVoting && (
              <span className={styles.phaseTag}>
                {idea.phase === 'group' ? 'group' : 'individual'}
              </span>
            )}
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

  /** Renders one chat bubble */
  function ChatBubble({ msg }) {
    const isMe = msg.authorId === user.uid
    const label = memberLabels[msg.authorId] || msg.authorLabel || '?'

    return (
      <div className={`${styles.chatBubble} ${isMe ? styles.chatBubbleMe : styles.chatBubbleOther}`}>
        {!isMe && <span className={styles.chatBubbleAuthor}>{label}</span>}
        <p className={styles.chatBubbleText}>{msg.text}</p>
        <span className={styles.chatBubbleTime}>{formatTime(msg.createdAt)}</span>
      </div>
    )
  }

  /** Chat panel (reused in both modes) */
  const chatPanel = (
    <div className={styles.chatSection}>
      <div className={styles.chatHeader}>
        <h3 className={styles.chatHeading}>Group Chat</h3>
        <span className={styles.chatSub}>Discuss and refine your ideas</span>
      </div>
      <div className={styles.chatMessages}>
        {messages.length === 0 && (
          <p className={styles.chatEmpty}>No messages yet. Start the conversation!</p>
        )}
        {messages.map(msg => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}
        <div ref={chatEndRef} />
      </div>
      <form className={styles.chatInputBar} onSubmit={sendChatMessage}>
        <input
          className={styles.chatInput}
          type="text"
          value={chatText}
          onChange={e => setChatText(e.target.value)}
          placeholder="Type a message..."
          disabled={sendingChat}
        />
        <button
          className={styles.chatSendBtn}
          type="submit"
          disabled={!chatText.trim() || sendingChat}
        >
          Send
        </button>
      </form>
    </div>
  )

  // ═══════════════════════════════════════════════════
  // VOTING MODE layout: left = all ideas, right = chat
  // ═══════════════════════════════════════════════════
  if (isVoting) {
    const votingPanel = (
      <div className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.topLeft}>
            <h1 className={styles.phaseTitle}>Group Voting Phase</h1>
            <div className={styles.memberPills}>
              {members.map(m => {
                const mLocked = m.votesSubmitted
                return (
                  <span
                    key={m.id}
                    className={[
                      styles.memberChip,
                      m.id === user.uid ? styles.memberChipMe : '',
                      mLocked ? styles.memberChipVoted : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {memberLabels[m.id] || m.anonymousLabel || 'Member'}
                    {m.id === user.uid && ' (you)'}
                    {mLocked && ' \u2713'}
                  </span>
                )
              })}
            </div>
          </div>
          <div className={styles.topRight}>
            <PhaseTimer
              phaseStartedAt={session?.phaseStartedAt}
              durationSeconds={pc.groupPhaseDuration}
            />
            <div className={styles.voteCounter}>
              <span className={styles.voteNum}>{myVoteCount}</span>
              <span className={styles.voteDen}>/ {MAX_VOTES}</span>
            </div>
            {votesLocked ? (
              <span className={styles.votesLockedBadge}>Votes submitted &#10003;</span>
            ) : (
              <button
                className={styles.proceedBtn}
                onClick={submitVotes}
                disabled={myVoteCount !== MAX_VOTES}
              >
                Submit Votes
              </button>
            )}
          </div>
        </div>

        {!votesLocked && (
          <div className={styles.votingHint}>
            Double-click any idea to vote. Select {MAX_VOTES} ideas to represent your group.
            {' '}<button className={styles.backLink} onClick={() => setSubPhase('ideation')}>
              Back to ideation
            </button>
          </div>
        )}

        <div className={styles.votingColumns}>
          {/* Left: all ideas merged */}
          <div className={styles.votingIdeasColumn}>
            <div className={styles.ideaList}>
              {allIdeasForVoting.map(idea => (
                <IdeaPill key={idea.id} idea={idea} variant={idea.phase === 'group' ? 'group' : 'individual'} />
              ))}
            </div>
          </div>

          {/* Right: chat only */}
          <div className={styles.votingChatColumn}>
            {chatPanel}
          </div>
        </div>
      </div>
    )

    return (
      <div className={styles.page}>
        <SplitLayout
          leftPanel={votingPanel}
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

  // ═══════════════════════════════════════════════════
  // IDEATION MODE layout: left = individual, right = group + chat
  // ═══════════════════════════════════════════════════
  const ideationPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Group Ideation Phase</h1>
          <div className={styles.memberPills}>
            {members.map(m => (
              <span
                key={m.id}
                className={[
                  styles.memberChip,
                  m.id === user.uid ? styles.memberChipMe : '',
                ].filter(Boolean).join(' ')}
              >
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
          <button
            className={styles.proceedBtn}
            onClick={() => setSubPhase('voting')}
          >
            Proceed to Voting
          </button>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Left: individual ideas */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Individual Ideas</h2>
          <p className={styles.columnSub}>Selected ideas from each member</p>
          <div className={styles.ideaList}>
            {sortedIndividual.map(idea => (
              <IdeaPill key={idea.id} idea={idea} variant="individual" />
            ))}
          </div>
        </div>

        {/* Right: group ideas + add form + chat */}
        <div className={styles.columnRight}>
          <div className={styles.groupIdeasSection}>
            <h2 className={styles.columnTitle}>Group Ideas</h2>
            <p className={styles.columnSub}>Generated together in this phase</p>
            <div className={styles.ideaList}>
              {sortedGroup.map(idea => (
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

          {chatPanel}
        </div>
      </div>
    </div>
  )

  return (
    <div className={styles.page}>
      <SplitLayout
        leftPanel={ideationPanel}
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