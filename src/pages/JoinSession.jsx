import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import styles from './JoinSession.module.css'

export default function JoinSession() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleJoin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const trimmedCode = code.trim().toUpperCase()

      // Validate the session code via a client-side Firestore query
      const sessionsQuery = query(
        collection(db, 'sessions'),
        where('code', '==', trimmedCode),
        where('status', '!=', 'done')
      )
      const snap = await getDocs(sessionsQuery)

      if (snap.empty) {
        setError('Session not found. Check the code and try again.')
        setLoading(false)
        return
      }

      const sessionId = snap.docs[0].id

      // Check if this participant already registered (rejoining)
      const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
      const participantSnap = await getDoc(participantRef)

      if (participantSnap.exists()) {
        // Already registered, skip welcome/registration and go to lobby
        navigate(`/session/${sessionId}`)
      } else {
        // New participant, show welcome page first
        navigate(`/session/${sessionId}/welcome`)
      }
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
        <div className={styles.userBar}>
          <span className={styles.userName}>{user?.displayName || user?.email}</span>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.icon} aria-hidden="true">&#x25C8;</div>
          <h1 className={styles.title}>Join a Session</h1>
          <p className={styles.desc}>
            Enter the session code provided by your instructor to begin.
          </p>

          <form onSubmit={handleJoin} className={styles.form}>
            <input
              className={`input-field ${styles.codeInput}`}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              maxLength={8}
              required
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="error-msg">{error}</p>}
            <button
              className={`btn-primary ${styles.joinBtn}`}
              type="submit"
              disabled={loading || code.trim().length < 4}
            >
              {loading ? 'Looking up session...' : 'Join Session'}
            </button>
          </form>
        </div>

        <p className={styles.hint}>
          Don't have a code? Ask your instructor for the session code before joining.
        </p>
      </main>
    </div>
  )
}