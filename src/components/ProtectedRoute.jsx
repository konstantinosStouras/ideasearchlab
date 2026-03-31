import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ADMIN_EMAIL = 'admin@admin.com'

// Blocks unauthenticated users
export function RequireAuth({ children }) {
  const { user } = useAuth()
  if (user === undefined) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--muted)' }}>Loading...</div>
  if (user === null) return <Navigate to="/login" replace />
  return children
}

// Blocks authenticated users from seeing login page
export function RequireGuest({ children }) {
  const { user } = useAuth()
  if (user === undefined) return null
  if (user !== null) {
    if (user.email === ADMIN_EMAIL) return <Navigate to="/admin" replace />
    return <Navigate to="/join" replace />
  }
  return children
}

// Only allows admin@admin.com
export function RequireInstructor({ children }) {
  const { user } = useAuth()
  if (user === undefined) return null
  if (user === null) return <Navigate to="/login" replace />
  if (user.email !== ADMIN_EMAIL) return <Navigate to="/join" replace />
  return children
}