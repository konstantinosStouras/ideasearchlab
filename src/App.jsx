import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { SessionProvider } from './context/SessionContext'
import { RequireAuth, RequireGuest, RequireInstructor } from './components/ProtectedRoute'

import Login from './pages/Login'
import JoinSession from './pages/JoinSession'
import SessionLobby from './pages/SessionLobby'
import IndividualPhase from './pages/IndividualPhase'
import GroupPhase from './pages/GroupPhase'
import VotingPhase from './pages/VotingPhase'
import Survey, { Done } from './pages/Survey'
import Admin from './pages/Admin'
import AISettings from './pages/AISettings'
import AdminSession from './pages/AdminSession'

// Wraps session pages with SessionProvider using the :sessionId param
function SessionWrapper({ children }) {
  const { sessionId } = useParams()
  return <SessionProvider sessionId={sessionId}>{children}</SessionProvider>
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Guest only */}
        <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />

        {/* Participant flow */}
        <Route path="/join" element={<RequireAuth><JoinSession /></RequireAuth>} />

        <Route path="/session/:sessionId" element={
          <RequireAuth>
            <SessionWrapper>
              <SessionLobby />
            </SessionWrapper>
          </RequireAuth>
        } />

        <Route path="/session/:sessionId/individual" element={
          <RequireAuth>
            <SessionWrapper>
              <IndividualPhase />
            </SessionWrapper>
          </RequireAuth>
        } />

        <Route path="/session/:sessionId/group" element={
          <RequireAuth>
            <SessionWrapper>
              <GroupPhase />
            </SessionWrapper>
          </RequireAuth>
        } />

        <Route path="/session/:sessionId/voting" element={
          <RequireAuth>
            <SessionWrapper>
              <VotingPhase />
            </SessionWrapper>
          </RequireAuth>
        } />

        <Route path="/session/:sessionId/survey" element={
          <RequireAuth>
            <SessionWrapper>
              <Survey />
            </SessionWrapper>
          </RequireAuth>
        } />

        <Route path="/session/:sessionId/done" element={
          <RequireAuth><Done /></RequireAuth>
        } />

        {/* Instructor flow */}
        <Route path="/admin" element={<RequireInstructor><Admin /></RequireInstructor>} />
        <Route path="/admin/ai-settings" element={<RequireInstructor><AISettings /></RequireInstructor>} />
        <Route path="/admin/session/:sessionId" element={
          <RequireInstructor>
            <SessionWrapper>
              <AdminSession />
            </SessionWrapper>
          </RequireInstructor>
        } />

        {/* Default */}
        <Route path="/" element={<Navigate to="/join" replace />} />
        <Route path="*" element={<Navigate to="/join" replace />} />
      </Routes>
    </AuthProvider>
  )
}
