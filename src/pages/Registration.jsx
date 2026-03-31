import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import styles from './Registration.module.css'

const AGE_OPTIONS = [
  '18-24', '25-34', '35-44', '45-54', '55-64', '65+',
]

const GENDER_OPTIONS = [
  'Prefer not to say', 'Male', 'Female', 'Non-binary', 'Other',
]

const STUDY_LEVEL_OPTIONS = [
  'Undergraduate', 'Postgraduate (Masters)', 'Postgraduate (PhD)',
  'MBA', 'Other',
]

const OCCUPATION_OPTIONS = [
  'Student', 'Employed full-time', 'Employed part-time',
  'Self-employed', 'Unemployed', 'Retired', 'Other',
]

const FLUENCY_OPTIONS = [
  'Native speaker', 'Fluent', 'Advanced', 'Intermediate', 'Basic',
]

export default function Registration() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { session } = useSession()

  const [form, setForm] = useState({
    age: '',
    gender: 'Prefer not to say',
    nationality: '',
    country: '',
    levelOfStudy: '',
    workExperience: '',
    occupation: '',
    englishFluency: '',
  })

  const [consent1, setConsent1] = useState(false)
  const [consent2, setConsent2] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function isValid() {
    return (
      form.age &&
      form.nationality.trim() &&
      form.country.trim() &&
      form.levelOfStudy &&
      form.workExperience.trim() &&
      form.occupation &&
      form.englishFluency &&
      consent1 &&
      consent2
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isValid()) {
      setError('Please complete all required fields and accept both consent statements.')
      return
    }

    setError('')
    setLoading(true)

    try {
      // 1. Call joinSession Cloud Function to register participant + trigger group formation
      const functions = getFunctions(undefined, 'europe-west1')
      const joinSession = httpsCallable(functions, 'joinSession')
      const result = await joinSession({ code: session.code })

      // 2. Write demographics to the participant document
      const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
      await updateDoc(participantRef, {
        demographics: {
          age: form.age,
          gender: form.gender,
          nationality: form.nationality.trim(),
          country: form.country.trim(),
          levelOfStudy: form.levelOfStudy,
          workExperience: form.workExperience.trim(),
          occupation: form.occupation,
          englishFluency: form.englishFluency,
        },
        consentGiven: true,
        consentTimestamp: new Date().toISOString(),
      })

      // 3. Navigate to the session lobby
      navigate(`/session/${sessionId}`)
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.title}>Registration</h1>
          <p className={styles.subtitle}>
            Please complete the information below to join the Ideation Challenge.
          </p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <h2 className={styles.sectionTitle}>Participant Information</h2>

            <div className={styles.row3}>
              <label className={styles.field}>
                <span className={styles.label}>Age <span className={styles.req}>*</span></span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.age}
                  onChange={e => updateField('age', e.target.value)}
                >
                  <option value="">Select...</option>
                  {AGE_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Gender (optional)</span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.gender}
                  onChange={e => updateField('gender', e.target.value)}
                >
                  {GENDER_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Nationality <span className={styles.req}>*</span></span>
                <input
                  className="input-field"
                  type="text"
                  value={form.nationality}
                  onChange={e => updateField('nationality', e.target.value)}
                  placeholder=""
                />
              </label>
            </div>

            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>Country <span className={styles.req}>*</span></span>
                <input
                  className="input-field"
                  type="text"
                  value={form.country}
                  onChange={e => updateField('country', e.target.value)}
                  placeholder=""
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Level of Study <span className={styles.req}>*</span></span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.levelOfStudy}
                  onChange={e => updateField('levelOfStudy', e.target.value)}
                >
                  <option value="">Select...</option>
                  {STUDY_LEVEL_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>Work Experience (in years) <span className={styles.req}>*</span></span>
                <input
                  className="input-field"
                  type="text"
                  value={form.workExperience}
                  onChange={e => updateField('workExperience', e.target.value)}
                  placeholder=""
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Occupation <span className={styles.req}>*</span></span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.occupation}
                  onChange={e => updateField('occupation', e.target.value)}
                >
                  <option value="">Select...</option>
                  {OCCUPATION_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.row1}>
              <label className={styles.field}>
                <span className={styles.label}>English Fluency <span className={styles.req}>*</span></span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.englishFluency}
                  onChange={e => updateField('englishFluency', e.target.value)}
                >
                  <option value="">Select...</option>
                  {FLUENCY_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>

            <hr className={styles.divider} />

            <h2 className={styles.sectionTitle}>Consent</h2>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={consent1}
                onChange={e => setConsent1(e.target.checked)}
              />
              <span>I confirm that I am 18 years or older and consent to participate in this research study.</span>
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={consent2}
                onChange={e => setConsent2(e.target.checked)}
              />
              <span>I understand that my responses will be used anonymously for research purposes only.</span>
            </label>

            {error && <p className="error-msg">{error}</p>}

            <div className={styles.submitRow}>
              <button
                className={`btn-primary ${styles.submitBtn}`}
                type="submit"
                disabled={loading || !isValid()}
              >
                {loading ? 'Joining...' : 'Submit and Start Challenge'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
