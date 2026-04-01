import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc, arrayUnion, arrayRemove
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
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

  // Sub-phase: 'group' = ideation, 'voting' = voting
  const [subPhase, setSubPhase] = useState('group')
  const [advancingTimer, setAdvancingTimer] = useState(false)

  // Chat state
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const chatEndRef = useRef(null)

  const pc = session?.phaseConfig || {}
  const aiEnabled = session?.aiConfig?.groupAI
  const ideasCarried = pc.ideasCarriedToGroup || 3
  const isVoting = subPhase === 'voting'

  // Get groupId, sub-phase, and react to status changes
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        const status = data.status
        if (status === 'group') setSubPhase('group')
        else if (status === 'voting') setSubPhase('voting')
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
  }, [sessionId, groupId, members, ideasCarried])

  // Listen to chat messages
  useEffect(() => {
    if (!sessionId || !groupId) return
    const q = query(
      collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, groupId])

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Auto-advance when timer expires
  const handleTimerExpire = useCallback(async () => {
    if (advancingTimer) return
    setAdvancingTimer(true)
    try {
      await httpsCallable(functions, 'autoAdvanceOnTimer')({
        sessionId,
        fromPhase: subPhase,
      })
    } catch (err) {
      console.error('autoAdvanceOnTimer error:', err)
    } finally {
      setAdvancingTimer(false)
    }
  }, [sessionId, subPhase, advancingTimer])

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
        votedBy: [],
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

  async function sendChatMessage() {
    const text = chatInput.trim()
    if (!text || sendingChat || !groupId) return

    setSendingChat(true)
    try {
      await addDoc(
        collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
        {
          authorId: user.uid,
          text,
          createdAt: serverTimestamp(),
        }
      )
      setChatInput('')
    } catch (err) {
      console.error('Chat send error:', err)
    } finally {
      setSendingChat(false)
    }
  }

  function handleChatKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChatMessage()
    }
  }

  // Voting: toggle vote on double-click
  async function toggleVote(idea) {
    if (!isVoting || !user) return
    const ideaRef = doc(db, 'sessions', sessionId, 'ideas', idea.id)
    const alreadyVoted = (idea.votedBy || []).includes(user.uid)

    try {
      if (alreadyVoted) {
        await updateDoc(ideaRef, { votedBy: arrayRemove(user.uid) })
      } else {
        // Check max votes across all ideas
        const allIdeasFlat = [...(ideas.individual || []), ...(ideas.group || [])]
        const currentVotes = allIdeasFlat.filter(i => (i.votedBy || []).includes(user.uid)).length
        if (currentVotes >= MAX_VOTES) return
        await updateDoc(ideaRef, { votedBy: arrayUnion(user.uid) })
      }
    } catch (err) {
      console.error('Vote error:', err)
    }
  }

  function formatTime(timestamp) {
    if (!timestamp?.seconds) return ''
    const d = new Date(timestamp.seconds * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Count how many votes this user has cast
  const allIdeasFlat = [...(ideas.individual || []), ...(ideas.group || [])]
  const myVoteCount = allIdeasFlat.filter(i => (i.votedBy || []).includes(user?.uid)).length

  // Sort ideas by votes in voting mode
  function sortByVotes(list) {
    if (!isVoting) return list
    return [...list].sort((a, b) => {
      const va = (a.votedBy || []).length
      const vb = (b.votedBy || []).length
      if (vb !== va) return vb - va
      return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    })
  }

  /** Renders one idea pill card */
  function IdeaPill({ idea, variant }) {
    const label = memberLabels[idea.authorId] || idea.anonymousLabel || '?'
    const isMe = idea.authorId === user.uid
    const voteCount = (idea.votedBy || []).length
    const iVoted = (idea.votedBy || []).includes(user?.uid)
    const canVote = isVoting && (iVoted || myVoteCount < MAX_VOTES)

    return (
      <div
        className={[
          styles.ideaPill,
          variant === 'group' ? styles.ideaPillGroup : '',
          isVoting ? styles.ideaPillVotable : '',
          iVoted ? styles.ideaPillVoted : '',
          isVoting && !canVote && !iVoted ? styles.ideaPillDisabled : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={() => isVoting && canVote && toggleVote(idea)}
        title={isVoting ? (iVoted ? 'Double-click to remove vote' : canVote ? 'Double-click to vote' : `Max ${MAX_VOTES} votes reached`) : ''}
      >
        <div className={styles.pillTop}>
          <div className={styles.pillMeta}>
            <span className={styles.pillAuthor}>{label}</span>
            {isMe && <span className={styles.youTag}>you</span>}
          </div>
          {voteCount > 0 && (
            <span className={styles.voteBadge}>
              Votes: {voteCount}
            </span>
          )}
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

  // Timer config based on sub-phase
  const timerDuration = isVoting ? pc.votingDuration : pc.groupPhaseDuration

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>
            {isVoting ? 'Group Voting Phase' : 'Group Ideation Phase'}
          </h1>
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
            durationSeconds={timerDuration}
            onExpire={handleTimerExpire}
          />
          {isVoting && (
            <div className={styles.voteCounter}>
              <span className={styles.voteNum}>{myVoteCount}</span>
              <span className={styles.voteDen}>/ {MAX_VOTES}</span>
            </div>
          )}
          <div className={styles.waitingMsg}>
            {isVoting
              ? 'Double-click ideas to vote for your top 3'
              : advancingTimer
                ? 'Advancing to voting...'
                : 'Ideation in progress'}
          </div>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Individual ideas column */}
        <div className={styles.column}>
          <h2 className={styles.columnTitle}>Individual Ideas</h2>
          <p className={styles.columnSub}>Selected ideas from each member</p>
          <div className={styles.ideaList}>
            {sortByVotes(ideas.individual || []).map(idea => (
              <IdeaPill key={idea.id} idea={idea} variant="individual" />
            ))}
          </div>
        </div>

        {/* Right column: Group Ideas + Chat */}
        <div className={styles.rightColumn}>
          {/* Group ideas section */}
          <div className={styles.groupIdeasSection}>
            <h2 className={styles.columnTitle}>Group Ideas</h2>
            <p className={styles.columnSub}>Generated together in this phase</p>
            <div className={styles.ideaList}>
              {sortByVotes(ideas.group || []).map(idea => (
                <IdeaPill key={idea.id} idea={idea} variant="group" />
              ))}

              {/* Add idea form: only in ideation mode */}
              {!isVoting && (
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
              )}
            </div>
          </div>

          {/* Group Chat section */}
          <div className={styles.chatSection}>
            <div className={styles.chatHeader}>
              <h2 className={styles.chatTitle}>Group Chat</h2>
              <p className={styles.chatSub}>Discuss and refine your ideas</p>
            </div>

            <div className={styles.chatMessages}>
              {chatMessages.length === 0 && (
                <div className={styles.chatEmpty}>
                  No messages yet. Start the conversation!
                </div>
              )}
              {chatMessages.map(msg => {
                const isMe = msg.authorId === user.uid
                const label = memberLabels[msg.authorId] || '?'
                return (
                  <div
                    key={msg.id}
                    className={`${styles.chatBubbleRow} ${isMe ? styles.chatBubbleRowMe : ''}`}
                  >
                    <div className={`${styles.chatBubble} ${isMe ? styles.chatBubbleMe : styles.chatBubbleOther}`}>
                      {!isMe && (
                        <span className={styles.chatAuthor}>{label}</span>
                      )}
                      <span className={styles.chatText}>{msg.text}</span>
                      <span className={styles.chatTime}>{formatTime(msg.createdAt)}</span>
                    </div>
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>

            <div className={styles.chatInputRow}>
              <textarea
                className={styles.chatInput}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type a message and press Enter to send (Shift+Enter for new line)..."
                rows={1}
                disabled={sendingChat}
              />
              <button
                className={styles.chatSendBtn}
                onClick={sendChatMessage}
                disabled={sendingChat || !chatInput.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className={styles.page}>
      <SplitLayout
        leftPanel={mainPanel}
        rightPanel={aiEnabled && !isVoting ? (
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