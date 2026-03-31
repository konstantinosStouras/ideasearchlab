import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch
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
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [groupMembers, setGroupMembers] = useState([])
  const [groupId, setGroupId] = useState(null)
  const [started, setStarted] = useState(false)
  const [briefOpen, setBriefOpen] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const pc = session?.phaseConfig || {}
  const maxIdeas = pc.maxIdeasIndividual || 5
  const aiEnabled = session?.aiConfig?.individualAI
  const durationMinutes = pc.individualPhaseDuration
    ? Math.round(pc.individualPhaseDuration / 60)
    : 10
  const ideasCarried = pc.ideasCarriedToGroup || 3
  const groupPhaseActive = pc.groupPhaseActive !== false

  useEffect(() => {
    if (!sessionId || !user) return
    const q = query(
      collection(db, 'sessions', sessionId, 'ideas'),
      where('authorId', '==', user.uid),
      where('phase', '==', 'individual'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setIdeas(list)
      const sel = new Set()
      list.forEach(idea => { if (idea.selected) sel.add(idea.id) })
      setSelectedIds(prev => prev.size === 0 && sel.size > 0 ? sel : prev)
    })
    return unsub
  }, [sessionId, user])

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
    const t = title.trim()
    const d = description.trim()
    if (!t || !d || submitting || ideas.length >= maxIdeas) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'individual',
        groupId: null,
        votes: 0,
        selected: false,
        createdAt: serverTimestamp(),
      })
      setTitle('')
      setDescription('')
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  function toggleSelect(ideaId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else {
        if (next.size >= ideasCarried) return prev
        next.add(ideaId)
      }
      return next
    })
  }

  function startEdit(idea) {
    setEditingId(idea.id)
    setEditTitle(idea.title || '')
    setEditDesc(idea.description || '')
  }

  async function saveEdit(ideaId) {
    const t = editTitle.trim()
    const d = editDesc.trim()
    if (!t || !d) return
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'ideas', ideaId), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
      })
    } catch (err) {
      console.error(err)
    }
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null) }

  async function deleteIdea(ideaId) {
    try {
      await deleteDoc(doc(db, 'sessions', sessionId, 'ideas', ideaId))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(ideaId)
        return next
      })
    } catch (err) {
      console.error(err)
    }
  }

  async function markDone() {
    if (done) return
    setDone(true)
    try {
      // 1. Mark participant as done (critical, should always succeed)
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { individualComplete: true, status: 'waiting_for_group' }
      )

      // 2. Try to mark selected ideas in Firestore (non-critical)
      //    Requires update rules on ideas subcollection.
      try {
        const batch = writeBatch(db)
        ideas.forEach(idea => {
          const ref = doc(db, 'sessions', sessionId, 'ideas', idea.id)
          batch.update(ref, { selected: selectedIds.has(idea.id) })
        })
        await batch.commit()
      } catch (ideaErr) {
        console.warn('Could not update idea selection flags:', ideaErr.message)
      }
    } catch (err) {
      console.error('Failed to submit:', err)
      setDone(false)
    }
  }

  // ─── Instructions view ───
  if (!started) {
    return (
      <div className={styles.instrPage}>
        <header className={styles.instrHeader}>
          <span className={styles.wordmark}>Ideation Challenge</span>
        </header>
        <div className={styles.instrContainer}>
          <h1 className={styles.instrPageTitle}>Individual Ideation Phase</h1>
          <p className={styles.instrPageSub}>
            Work independently to generate ideas for the health &amp; wellness market
          </p>
          <div className={styles.instrCard}>
            <h2 className={styles.instrCardTitle}>Instructions</h2>
            <div className={styles.instrBody}>
              <p>
                Welcome to the <strong>Individual Phase</strong> of the challenge.
              </p>
              <p>
                In this part, you'll work <strong>completely on your own</strong> to
                generate ideas for new products in the{' '}
                <strong>health and wellness market</strong>. Please{' '}
                <strong>do not communicate or collaborate</strong> with others during
                this phase.
              </p>
              <p>
                Focus on creating as many ideas as you can, big or small, practical or
                experimental. Each idea should aim to offer value, improvement, or
                innovation in health and wellness.
              </p>
              <p>
                You'll have a limited amount of time to complete this phase, so work
                efficiently and record your ideas clearly. There is a timer at the top.
                You have <strong>{durationMinutes} minutes</strong> to complete this
                phase. When the timer ends, you'll move on to the next stage.
              </p>
              {groupPhaseActive && (
                <p>
                  Try to write your ideas within {durationMinutes} minutes or you will
                  be at a disadvantage when you go to the group phase.
                </p>
              )}
              <div className={styles.taskSection}>
                <h3 className={styles.taskTitle}>Your task</h3>
                <div className={styles.taskList}>
                  <div className={styles.taskItem}>Think independently</div>
                  <div className={styles.taskItem}>Develop original product ideas</div>
                  <div className={styles.taskItem}>Describe each idea briefly and clearly</div>
                </div>
              </div>
            </div>
            <button className={`btn-primary ${styles.startBtn}`} onClick={() => setStarted(true)}>
              Start
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Workspace view ───
  const atMax = ideas.length >= maxIdeas
  const hasSelection = selectedIds.size > 0
  const canFinish = ideas.length > 0 && hasSelection && !done

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
          <button className={`btn-primary ${styles.doneBtn}`} onClick={markDone} disabled={!canFinish}>
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

      {/* Collapsible task brief */}
      <div className={styles.brief}>
        <button className={styles.briefToggle} onClick={() => setBriefOpen(o => !o)} type="button">
          <span>Task Brief</span>
          <span className={styles.briefChevron}>{briefOpen ? '\u25B2' : '\u25BC'}</span>
        </button>
        {briefOpen && (
          <div className={styles.briefContent}>
            <p>
              Design a <strong>completely new product</strong> for people who want to
              improve their sleep wellness. Consider what users currently have and what
              unmet needs remain.
            </p>
            <div className={styles.exampleBox}>
              <div className={styles.exampleImgWrap}>
                <img
                  src={`${import.meta.env.BASE_URL}images/sleep-mask-example.png`}
                  alt="Example: Bluetooth sleep mask"
                  className={styles.exampleImg}
                  onError={e => { e.target.style.display = 'none' }}
                />
              </div>
              <p className={styles.exampleText}>
                <strong>Example:</strong> A Bluetooth sleep mask that blocks light and
                plays relaxing audio through built-in headphones, helping users rest and
                sleep more comfortably.
              </p>
            </div>
            <div className={styles.briefDetails}>
              <p>
                You can generate up to <strong>{maxIdeas} original product ideas</strong>.
                Each idea should include an <strong>idea title</strong> and a{' '}
                <strong>description</strong> explaining what it does, how it
                works, and why it's unique.
              </p>
              <p>Use the following <strong>evaluation criteria</strong> to guide your thinking:</p>
              <ul>
                <li><strong>Novelty:</strong> Is the idea new, surprising, and original?</li>
                <li><strong>Feasibility:</strong> Can it be developed with today's technology?</li>
                <li><strong>Financial Value:</strong> Does it have market potential?</li>
                <li><strong>Overall Quality:</strong> Is it well-structured and relevant?</li>
              </ul>
              {aiEnabled && (
                <p className={styles.aiNote}>
                  AI is available on the right panel to help you brainstorm, develop,
                  and evaluate your ideas.
                </p>
              )}
              {groupPhaseActive && (
                <p>
                  When you're done, <strong>double-click</strong> your
                  best <strong>{ideasCarried} ideas</strong> to select them. These will
                  be carried forward to the group phase.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selection indicator */}
      {groupPhaseActive && ideas.length > 0 && !done && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionLabel}>
            Selected ideas: <strong>{selectedIds.size} / {ideasCarried}</strong>
          </span>
          <span className={styles.selectionHint}>Double-click an idea to select or deselect it</span>
        </div>
      )}

      {/* Idea list */}
      <div className={styles.ideaList}>
        {ideas.map((idea, i) => {
          const isSelected = selectedIds.has(idea.id)
          const isEditing = editingId === idea.id

          if (isEditing) {
            return (
              <div key={idea.id} className={styles.ideaPill + ' ' + styles.ideaPillEditing}>
                <div className={styles.editFields}>
                  <input
                    className={styles.editTitleInput}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Idea title"
                    autoFocus
                  />
                  <textarea
                    className={styles.editDescInput}
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Description"
                    rows={2}
                  />
                  <div className={styles.editActions}>
                    <button
                      className={`btn-primary ${styles.editSaveBtn}`}
                      onClick={() => saveEdit(idea.id)}
                      disabled={!editTitle.trim() || !editDesc.trim()}
                    >
                      Save
                    </button>
                    <button className={`btn-ghost ${styles.editCancelBtn}`} onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div
              key={idea.id}
              className={`${styles.ideaPill} ${isSelected ? styles.ideaPillSelected : ''}`}
              onDoubleClick={() => !done && toggleSelect(idea.id)}
            >
              <div className={styles.pillTop}>
                <h3 className={styles.pillTitle}>{idea.title || idea.text}</h3>
                <div className={styles.pillActions}>
                  {isSelected && <span className={styles.selectedBadge}>Selected</span>}
                  {!done && (
                    <>
                      <button
                        className={styles.editBtn}
                        onClick={e => { e.stopPropagation(); startEdit(idea) }}
                        title="Edit idea"
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M10.08 1.34a1.17 1.17 0 0 1 1.66 0l.92.92a1.17 1.17 0 0 1 0 1.66L4.8 11.78l-3.3.92.92-3.3L10.08 1.34Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={e => { e.stopPropagation(); deleteIdea(idea.id) }}
                        title="Delete idea"
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M1.5 3.5h11M5 3.5V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M3.5 3.5l.5 8.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M5.5 6v4M8.5 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
              {idea.description && (
                <>
                  <div className={styles.pillDivider} />
                  <p className={styles.pillDesc}>{idea.description}</p>
                </>
              )}
            </div>
          )
        })}

        {!done && !atMax && (
          <form onSubmit={submitIdea} className={styles.addPill}>
            <input
              className={styles.addTitleInput}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Idea title"
              disabled={submitting || done}
            />
            <div className={styles.addDivider} />
            <textarea
              className={styles.addDescInput}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Description"
              rows={2}
              disabled={submitting || done}
            />
            <div className={styles.addFooter}>
              <span className={styles.addCount}>{ideas.length} / {maxIdeas} ideas</span>
              <button
                className={`btn-primary ${styles.addBtn}`}
                type="submit"
                disabled={submitting || !title.trim() || !description.trim() || done}
              >
                {submitting ? 'Adding...' : '+ Add Idea'}
              </button>
            </div>
          </form>
        )}

        {atMax && !done && (
          <div className={styles.maxReached}>
            Maximum ideas reached.
            {groupPhaseActive
              ? ` Double-click to select your top ${ideasCarried}, then click Finish & Submit.`
              : ' Review your ideas above and click Finish when ready.'}
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
          <AIChat sessionId={sessionId} scope="individual" scopeId={user?.uid} aiConfig={session?.aiConfig} />
        ) : null}
        defaultSplit={58}
      />
    </div>
  )
}