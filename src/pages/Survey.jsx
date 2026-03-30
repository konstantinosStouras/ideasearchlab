import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import { SURVEY_QUESTIONS } from '../data/surveyQuestions'
import styles from './Survey.module.css'

export default function Survey() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const visibleQuestions = SURVEY_QUESTIONS.filter(q =>
    !q.showIf || q.showIf(session)
  )

  function setAnswer(id, value) {
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  const allAnswered = visibleQuestions.every(q => answers[q.id] !== undefined && answers[q.id] !== '')

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.top}>
          <h1 className={styles.title}>Post-Session Survey</h1>
          <p className={styles.sub}>Please answer all questions before finishing.</p>
        </div>

        <form onSubmit={submitSurvey} className={styles.form}>
          {visibleQuestions.map((q, i) => (
            <div key={q.id} className={styles.question}>
              <label className={styles.qLabel}>
                <span className={styles.qNum}>{i + 1}</span>
                {q.text}
              </label>

              {q.type === 'likert' && (
                <div className={styles.likert}>
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <label key={n} className={styles.likertOption}>
                      <input
                        type="radio"
                        name={q.id}
                        value={n}
                        checked={answers[q.id] === n}
                        onChange={() => setAnswer(q.id, n)}
                      />
                      <span className={`${styles.likertDot} ${answers[q.id] === n ? styles.likertSelected : ''}`}>
                        {n}
                      </span>
                    </label>
                  ))}
                  <div className={styles.likertLabels}>
                    <span>Strongly disagree</span>
                    <span>Strongly agree</span>
                  </div>
                </div>
              )}

              {q.type === 'freetext' && (
                <textarea
                  className={`input-field ${styles.freetext}`}
                  value={answers[q.id] || ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  placeholder="Your answer..."
                  rows={4}
                />
              )}
            </div>
          ))}

          <button
            className={`btn-primary ${styles.submitBtn}`}
            type="submit"
            disabled={!allAnswered || submitting}
          >
            {submitting ? 'Submitting...' : 'Complete Session'}
          </button>
        </form>
      </div>
    </div>
  )
}

export function Done() {
  return (
    <div className={styles.donePage}>
      <div className={styles.doneCard}>
        <div className={styles.doneIcon}>◈</div>
        <h1 className={styles.doneTitle}>All done.</h1>
        <p className={styles.doneSub}>
          Thank you for participating. Your responses have been recorded.
          You may close this window.
        </p>
      </div>
    </div>
  )
}
