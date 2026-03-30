import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../firebase'
import styles from './Login.module.css'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
      }
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  function friendlyError(code) {
    const map = {
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/invalid-credential': 'Incorrect email or password.',
    }
    return map[code] || 'Something went wrong. Please try again.'
  }

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.leftInner}>
          <div className={styles.wordmark}>Ideation Challenge</div>
          <h1 className={styles.headline}>
            Where ideas<br />
            <em>come alive.</em>
          </h1>
          <p className={styles.sub}>
            A structured environment for individual and collaborative ideation,
            powered by AI assistance.
          </p>
        </div>
        <div className={styles.decoration} aria-hidden="true">
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="160" stroke="currentColor" strokeWidth="1" strokeDasharray="4 8" opacity="0.3"/>
            <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
            <circle cx="200" cy="200" r="40" fill="currentColor" opacity="0.08"/>
            <line x1="200" y1="40" x2="200" y2="360" stroke="currentColor" strokeWidth="1" opacity="0.15"/>
            <line x1="40" y1="200" x2="360" y2="200" stroke="currentColor" strokeWidth="1" opacity="0.15"/>
          </svg>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.formCard}>
          <div className={styles.tabs}>
            <button
              className={mode === 'login' ? styles.tabActive : styles.tab}
              onClick={() => { setMode('login'); setError('') }}
            >
              Sign In
            </button>
            <button
              className={mode === 'register' ? styles.tabActive : styles.tab}
              onClick={() => { setMode('register'); setError('') }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            {mode === 'register' && (
              <div className={styles.field}>
                <label className={styles.label}>Full Name</label>
                <input
                  className="input-field"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                />
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input
                className="input-field"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input
                className="input-field"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && <p className="error-msg">{error}</p>}

            <button
              className={`btn-primary ${styles.submitBtn}`}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
