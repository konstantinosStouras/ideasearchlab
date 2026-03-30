import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

const SessionContext = createContext(null)

export function SessionProvider({ sessionId, children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }

    const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
      if (snap.exists()) {
        setSession({ id: snap.id, ...snap.data() })
      } else {
        setSession(null)
      }
      setLoading(false)
    })

    return unsub
  }, [sessionId])

  return (
    <SessionContext.Provider value={{ session, loading }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
