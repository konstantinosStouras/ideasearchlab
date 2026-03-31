import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import styles from './Registration.module.css'

// ── Option lists ────────────────────────────

const AGE_OPTIONS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']

const GENDER_OPTIONS = ['Prefer not to say', 'Male', 'Female', 'Non-binary', 'Other']

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

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
  'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile',
  'China', 'Colombia', 'Comoros', 'Congo (DRC)', 'Congo (Republic)',
  'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
  'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
  'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland',
  'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo',
  'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
  'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives',
  'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius',
  'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia',
  'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua',
  'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
  'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
  'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
  'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
  'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
]

// ── Component ───────────────────────────────

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

  function validate() {
    if (!form.age) return 'Please select your age range.'
    if (!form.nationality) return 'Please select your nationality.'
    if (!form.country) return 'Please select your country of residence.'
    if (!form.levelOfStudy) return 'Please select your level of study.'

    const exp = form.workExperience.trim()
    if (!exp) return 'Please enter your work experience in years.'
    const expNum = Number(exp)
    if (isNaN(expNum) || !Number.isInteger(expNum) || expNum < 0 || expNum > 50) {
      return 'Work experience must be a whole number between 0 and 50.'
    }

    if (!form.occupation) return 'Please select your occupation.'
    if (!form.englishFluency) return 'Please select your English fluency level.'
    if (!consent1 || !consent2) return 'Please accept both consent statements to continue.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setLoading(true)

    try {
      const functions = getFunctions(undefined, 'europe-west1')
      const joinSession = httpsCallable(functions, 'joinSession')
      await joinSession({ code: session.code })

      const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
      await updateDoc(participantRef, {
        demographics: {
          age: form.age,
          gender: form.gender,
          nationality: form.nationality,
          country: form.country,
          levelOfStudy: form.levelOfStudy,
          workExperience: Number(form.workExperience.trim()),
          occupation: form.occupation,
          englishFluency: form.englishFluency,
        },
        consentGiven: true,
        consentTimestamp: new Date().toISOString(),
      })

      navigate(`/session/${sessionId}`)
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const isValid = validate() === null

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
                <select
                  className={`input-field ${styles.select}`}
                  value={form.nationality}
                  onChange={e => updateField('nationality', e.target.value)}
                >
                  <option value="">Select...</option>
                  {COUNTRIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>Country of residence <span className={styles.req}>*</span></span>
                <select
                  className={`input-field ${styles.select}`}
                  value={form.country}
                  onChange={e => updateField('country', e.target.value)}
                >
                  <option value="">Select...</option>
                  {COUNTRIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={form.workExperience}
                  onChange={e => updateField('workExperience', e.target.value)}
                  placeholder="e.g. 3"
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
                disabled={loading || !isValid}
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