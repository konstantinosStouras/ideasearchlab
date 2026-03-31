import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import { SURVEY_QUESTIONS, SURVEY_TITLE, SURVEY_SUBTITLE } from '../data/surveyQuestions'
import styles from './Survey.module.css'

export default function Survey() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const navigate = useNavigate()
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        if (snap.data().status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  const visibleQuestions = SURVEY_QUESTIONS.filter(q =>
    !q.showIf || q.showIf(session)
  )

  function setAnswer(id, value) {
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  function setRatingGroupAnswer(parentId, subId, value) {
    setAnswers(prev => ({
      ...prev,
      [parentId]: { ...(prev[parentId] || {}), [subId]: value },
    }))
  }

  const allAnswered = visibleQuestions.every(q => {
    if (q.type === 'rating_group') {
      const group = answers[q.id]
      if (!group) return false
      return q.items.every(item => group[item.id] !== undefined)
    }
    if (q.type === 'radio' && q.followUp) {
      const val = answers[q.id]
      if (val === undefined || val === '') return false
      if (val === q.followUp.trigger) {
        const followUpVal = answers[q.followUp.id]
        return followUpVal !== undefined && followUpVal.trim() !== ''
      }
      return true
    }
    return answers[q.id] !== undefined && answers[q.id] !== ''
  })

  async function submitSurvey(e) {
    e.preventDefault()
    if (!allAnswered || submitting) return
    setSubmitting(true)
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), {
        status: 'done',
        surveyAnswers: answers,
        surveyCompletedAt: serverTimestamp(),
      })
      setSubmitted(true)
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return <Done />

  // Group visible questions into sections
  const sections = []
  let current = null
  let num = 0

  visibleQuestions.forEach(q => {
    num++
    if (q.section) {
      current = { title: q.section, questions: [] }
      sections.push(current)
    }
    if (!current) {
      current = { title: null, questions: [] }
      sections.push(current)
    }
    current.questions.push({ ...q, num })
  })

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
      </header>

      <div className={styles.container}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{SURVEY_TITLE}</h1>
          <p className={styles.subtitle}>{SURVEY_SUBTITLE}</p>
        </div>

        <form onSubmit={submitSurvey} className={styles.form}>
          {sections.map((sec, si) => (
            <div key={si} className={styles.sectionCard}>
              {sec.title && (
                <div className={styles.sectionHeading}>{sec.title}</div>
              )}

              <div className={styles.sectionBody}>
                {sec.questions.map((q, qi) => (
                  <div
                    key={q.id}
                    className={`${styles.question} ${qi > 0 ? styles.questionBorder : ''}`}
                  >
                    <div className={styles.qLabel}>
                      {q.text}
                      {q.required !== false && <span className={styles.req}> *</span>}
                    </div>

                    {/* ── likert5: connected dot scale ── */}
                    {q.type === 'likert5' && (
                      <div className={styles.scaleWrap}>
                        <div className={styles.scaleTrack}>
                          <div className={styles.scaleLine} />
                          {[1, 2, 3, 4, 5].map(n => (
                            <label key={n} className={styles.scalePoint}>
                              <input
                                type="radio"
                                name={q.id}
                                value={n}
                                checked={answers[q.id] === n}
                                onChange={() => setAnswer(q.id, n)}
                              />
                              <span
                                className={`${styles.dot} ${answers[q.id] === n ? styles.dotActive : ''}`}
                              >
                                {n}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className={styles.scaleAnchors}>
                          <span>{q.lowLabel}</span>
                          <span>{q.highLabel}</span>
                        </div>
                      </div>
                    )}

                    {/* ── rating_group: table grid ── */}
                    {q.type === 'rating_group' && (
                      <div className={styles.ratingTable}>
                        <div className={styles.ratingHeadRow}>
                          <span className={styles.ratingHeadLabel} />
                          {[1, 2, 3, 4, 5].map(n => (
                            <span key={n} className={styles.ratingHeadNum}>{n}</span>
                          ))}
                        </div>
                        {q.items.map((item, idx) => {
                          const ga = answers[q.id] || {}
                          return (
                            <div
                              key={item.id}
                              className={`${styles.ratingRow} ${idx % 2 === 0 ? styles.ratingRowShaded : ''}`}
                            >
                              <span className={styles.ratingLabel}>{item.label}</span>
                              {[1, 2, 3, 4, 5].map(n => (
                                <label key={n} className={styles.ratingCell}>
                                  <input
                                    type="radio"
                                    name={`${q.id}_${item.id}`}
                                    value={n}
                                    checked={ga[item.id] === n}
                                    onChange={() => setRatingGroupAnswer(q.id, item.id, n)}
                                  />
                                  <span className={`${styles.ratingCircle} ${ga[item.id] === n ? styles.ratingCircleActive : ''}`} />
                                </label>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* ── radio: pill buttons ── */}
                    {q.type === 'radio' && (
                      <div className={styles.radioWrap}>
                        <div className={styles.radioRow}>
                          {q.options.map(opt => (
                            <label key={opt} className={styles.radioLabel}>
                              <input
                                type="radio"
                                name={q.id}
                                value={opt}
                                checked={answers[q.id] === opt}
                                onChange={() => setAnswer(q.id, opt)}
                              />
                              <span className={`${styles.radioPill} ${answers[q.id] === opt ? styles.radioPillActive : ''}`}>
                                {opt}
                              </span>
                            </label>
                          ))}
                        </div>
                        {q.followUp && (
                          <div className={styles.followUp}>
                            <span className={styles.followUpPrompt}>{q.followUp.prompt}</span>
                            {answers[q.id] === q.followUp.trigger && (
                              <input
                                type="text"
                                className={`input-field ${styles.followUpInput}`}
                                value={answers[q.followUp.id] || ''}
                                onChange={e => setAnswer(q.followUp.id, e.target.value)}
                                placeholder="Type your answer..."
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── freetext ── */}
                    {q.type === 'freetext' && (
                      <textarea
                        className={styles.freetext}
                        value={answers[q.id] || ''}
                        onChange={e => setAnswer(q.id, e.target.value)}
                        placeholder="Type your answer..."
                        rows={3}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className={styles.footer}>
            <span className={styles.footerNote}>Questions marked with * are required.</span>
            <button
              className={`btn-primary ${styles.submitBtn}`}
              type="submit"
              disabled={!allAnswered || submitting}
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Done() {
  return (
    <div className={styles.donePage}>
      <div className={styles.doneCard}>
        <div className={styles.doneIcon}>&#x25C8;</div>
        <h1 className={styles.doneTitle}>All done.</h1>
        <p className={styles.doneSub}>
          Thank you for participating. Your responses have been recorded.
          You may close this window.
        </p>
      </div>
    </div>
  )
}