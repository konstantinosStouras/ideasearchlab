const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * tryFormGroup
 * Called after a new participant joins. If enough participants are waiting,
 * immediately forms a group and starts their first phase.
 *
 * joiningUid is passed explicitly to guard against the Firestore read-after-write
 * race condition: the query may not yet include the participant who just joined.
 */
async function tryFormGroup(sessionId, session, joiningUid = null) {
  const sessionRef = db.collection('sessions').doc(sessionId)
  const groupSize = session.phaseConfig?.groupSize ?? 3
  const individualActive = session.phaseConfig?.individualPhaseActive ?? true
  const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
  const firstPhase = (individualActive && phaseOrder === 'individual_first') ? 'individual' : 'group'

  const waitingSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting')
    .get()

  const waitingFromDB = waitingSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Inject the joining participant if Firestore hasn't reflected their write yet
  const alreadyIncluded = waitingFromDB.some(p => p.id === joiningUid)
  const waiting = (joiningUid && !alreadyIncluded)
    ? [...waitingFromDB, { id: joiningUid, status: 'waiting' }]
    : waitingFromDB

  if (waiting.length < groupSize) return // not enough participants yet

  // Take exactly groupSize participants and assign anonymous labels
  const groupMembers = waiting.slice(0, groupSize)
  const groupRef = sessionRef.collection('groups').doc()
  const memberLabels = {}
  groupMembers.forEach((p, i) => { memberLabels[p.id] = `p${i + 1}` })

  const batch = db.batch()

  batch.set(groupRef, {
    members: groupMembers.map(p => p.id),
    memberLabels,
    status: 'active',
    finalIdeas: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  groupMembers.forEach(p => {
    batch.update(sessionRef.collection('participants').doc(p.id), {
      groupId: groupRef.id,
      status: firstPhase,
      anonymousLabel: memberLabels[p.id],
    })
  })

  // Re-read the session status from Firestore to avoid acting on a stale snapshot.
  // The `session` object passed in was captured at join time and may already be outdated
  // if a concurrent join already advanced the session.
  const freshSessionSnap = await sessionRef.get()
  if (freshSessionSnap.exists && freshSessionSnap.data().status === 'waiting') {
    batch.update(sessionRef, {
      status: firstPhase,
      phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()
}

/**
 * joinSession
 * Validates a session code and registers the participant.
 * Called from the JoinSession page.
 * After registering, attempts to form a group immediately if enough are waiting.
 */
exports.joinSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { code } = data
  if (!code) throw new functions.https.HttpsError('invalid-argument', 'Session code required.')

  const snap = await db.collection('sessions')
    .where('code', '==', code.trim().toUpperCase())
    .where('status', '!=', 'done')
    .limit(1)
    .get()

  if (snap.empty) throw new functions.https.HttpsError('not-found', 'Session not found.')

  const sessionDoc = snap.docs[0]
  const sessionId = sessionDoc.id
  const session = sessionDoc.data()

  const participantRef = db
    .collection('sessions').doc(sessionId)
    .collection('participants').doc(context.auth.uid)

  const existingSnap = await participantRef.get()

  if (existingSnap.exists) {
    // Participant already registered — only update name/email, never touch
    // status, individualComplete, or groupId (those track session progress)
    await participantRef.update({
      name: context.auth.token.name || context.auth.token.email,
      email: context.auth.token.email,
    })
  } else {
    // First join — create the participant document with initial state
    await participantRef.set({
      name: context.auth.token.name || context.auth.token.email,
      email: context.auth.token.email,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'waiting',
      individualComplete: false,
      groupId: null,
    })

    // Try to form a group immediately if enough participants are now waiting
    await tryFormGroup(sessionId, session, context.auth.uid)
  }

  return { sessionId, status: session.status }
})


/**
 * advancePhase
 * Moves the session to the next phase in its sequence.
 * Only the instructor (session owner) can call this.
 * Also updates participant statuses accordingly.
 */
exports.advancePhase = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId } = data
  if (!sessionId) throw new functions.https.HttpsError('invalid-argument', 'sessionId required.')

  const sessionRef = db.collection('sessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')

  const session = sessionSnap.data()

  if (session.instructorId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the instructor can advance phases.')
  }

  const sequence = getPhaseSequence(session.phaseConfig)
  const currentIndex = sequence.indexOf(session.status)
  if (currentIndex === -1 || currentIndex >= sequence.length - 1) {
    throw new functions.https.HttpsError('failed-precondition', 'Session is already at the final phase.')
  }

  const nextPhase = sequence[currentIndex + 1]

  // Update session status
  await sessionRef.update({
    status: nextPhase,
    phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Update participant statuses based on next phase
  const participantsSnap = await sessionRef.collection('participants').get()
  const batch = db.batch()

  participantsSnap.docs.forEach(pDoc => {
    const p = pDoc.data()
    let newStatus = p.status

    if (nextPhase === 'individual') {
      // Move any waiting participants into the individual phase
      if (p.status === 'waiting') newStatus = 'individual'
    }

    if (nextPhase === 'group') {
      if (session.phaseConfig?.phaseOrder === 'group_first') {
        // group_first: move waiting participants directly into group
        if (p.status === 'waiting') newStatus = 'group'
      } else {
        // individual_first: force-advance anyone who hasn't reached group yet
        // This covers: still waiting, still in individual, or stuck in transition
        if (['waiting', 'individual'].includes(p.status)) newStatus = 'group'
      }
    }

    if (nextPhase === 'voting') {
      // Move all participants currently in group phase into voting
      if (p.status === 'group') newStatus = 'voting'
    }

    if (nextPhase === 'survey') {
      // Move everyone who hasn't completed the survey yet
      if (!['survey', 'done'].includes(p.status)) newStatus = 'survey'
    }

    if (nextPhase === 'done') {
      newStatus = 'done'
    }

    if (newStatus !== p.status) {
      batch.update(pDoc.ref, { status: newStatus })
    }
  })

  await batch.commit()

  if (nextPhase === 'group' && session.phaseConfig?.phaseOrder === 'group_first') {
    await preAssignGroups(sessionId, participantsSnap.docs.map(d => ({ id: d.id, ...d.data() })), session.phaseConfig)
  }

  return { nextPhase }
})


/**
 * Pre-assigns groups when phaseOrder === 'group_first'.
 * Groups participants immediately without waiting for individual completion.
 */
async function preAssignGroups(sessionId, participants, phaseConfig) {
  const sessionRef = db.collection('sessions').doc(sessionId)
  const groupSize = phaseConfig?.groupSize ?? 3
  const shuffled = [...participants].sort(() => Math.random() - 0.5)
  const batch = db.batch()

  let i = 0
  while (i < shuffled.length) {
    const remaining = shuffled.length - i

    if (remaining === 1) {
      batch.update(
        sessionRef.collection('participants').doc(shuffled[i].id),
        { status: 'survey' }
      )
      i++
      continue
    }

    const size = Math.min(groupSize, remaining)
    const groupMembers = shuffled.slice(i, i + size)
    const groupRef = sessionRef.collection('groups').doc()

    batch.set(groupRef, {
      members: groupMembers.map(m => m.id),
      status: 'active',
      finalIdeas: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    groupMembers.forEach(m => {
      batch.update(
        sessionRef.collection('participants').doc(m.id),
        { groupId: groupRef.id, status: 'group' }
      )
    })

    i += size
  }

  await batch.commit()
}


/**
 * Shared phase sequence logic (mirrors frontend utils/phaseSequence.js).
 * Must stay in sync with the frontend version.
 */
function getPhaseSequence(phaseConfig = {}) {
  const {
    individualPhaseActive = true,
    groupPhaseActive = true,
    phaseOrder = 'individual_first',
  } = phaseConfig

  const sequence = ['waiting']

  if (individualPhaseActive && groupPhaseActive) {
    if (phaseOrder === 'individual_first') {
      sequence.push('individual', 'group', 'voting')
    } else {
      sequence.push('group', 'voting', 'individual')
    }
  } else if (individualPhaseActive) {
    sequence.push('individual')
  } else if (groupPhaseActive) {
    sequence.push('group', 'voting')
  }

  sequence.push('survey', 'done')
  return sequence
}


/**
 * onParticipantUpdated
 * Firestore trigger: when a participant's status changes to 'done',
 * check if all participants in the session are done and advance session to 'done'.
 */
exports.onParticipantUpdated = functions.firestore
  .document('sessions/{sessionId}/participants/{participantId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()

    // Only act when status just became 'done'
    if (before.status === after.status || after.status !== 'done') return null

    const { sessionId } = context.params
    const sessionRef = db.collection('sessions').doc(sessionId)
    const sessionSnap = await sessionRef.get()
    if (!sessionSnap.exists) return null

    // Only advance if session is currently in 'survey'
    if (sessionSnap.data().status !== 'survey') return null

    const participantsSnap = await sessionRef.collection('participants').get()
    const allDone = participantsSnap.docs.every(d => d.data().status === 'done')

    if (allDone) {
      await sessionRef.update({
        status: 'done',
        phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }

    return null
  })