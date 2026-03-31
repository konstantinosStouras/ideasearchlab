const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * joinSession
 *
 * Registers the participant. If enough people are now in the lobby to fill a
 * group, immediately assigns them all to a group and starts their first phase.
 * Groups form on a rolling basis: once X people are unassigned in the lobby,
 * they get a group and begin. Remaining participants wait until more join.
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
    // Rejoin — only update name/email, never touch progress fields
    await participantRef.update({
      name: context.auth.token.name || context.auth.token.email,
      email: context.auth.token.email,
    })
    return { sessionId, status: session.status }
  }

  // First join — register with waiting status
  await participantRef.set({
    name: context.auth.token.name || context.auth.token.email,
    email: context.auth.token.email,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'waiting',
    individualComplete: false,
    groupId: null,
  })

  // Try to form a group from waiting participants
  await tryFormGroup(sessionId, session)

  return { sessionId, status: session.status }
})


/**
 * tryFormGroup
 *
 * Checks if enough unassigned participants are waiting to form a group.
 * If yes, assigns them a group and moves them to the first phase.
 * Uses a transaction to prevent race conditions.
 */
async function tryFormGroup(sessionId, session) {
  const groupSize = session.phaseConfig?.groupSize ?? 3
  const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
  const individualActive = session.phaseConfig?.individualPhaseActive ?? true
  const groupActive = session.phaseConfig?.groupPhaseActive ?? true

  // Determine which phase participants should enter
  let firstPhase
  if (individualActive && phaseOrder === 'individual_first') {
    firstPhase = 'individual'
  } else if (groupActive) {
    firstPhase = 'group'
  } else {
    firstPhase = 'survey'
  }

  const sessionRef = db.collection('sessions').doc(sessionId)

  // Query waiting participants OUTSIDE transaction (transactions don't support queries)
  const waitingSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting')
    .get()

  const waiting = waitingSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  if (waiting.length < groupSize) return // not enough yet

  // Take the first groupSize participants and shuffle for anonymous ordering
  const toAssign = waiting.slice(0, groupSize)
  const shuffled = [...toAssign].sort(() => Math.random() - 0.5)

  // Create group document with anonymised member labels
  const groupRef = sessionRef.collection('groups').doc()
  const memberLabels = {}
  shuffled.forEach((p, i) => {
    memberLabels[p.id] = `p${i + 1}`
  })

  const batch = db.batch()

  batch.set(groupRef, {
    members: shuffled.map(p => p.id),
    memberLabels,
    status: 'active',
    finalIdeas: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Move participants into their first phase
  shuffled.forEach(p => {
    batch.update(sessionRef.collection('participants').doc(p.id), {
      groupId: groupRef.id,
      status: firstPhase,
      anonymousLabel: memberLabels[p.id],
    })
  })

  // If session is still waiting, advance it to the first phase
  const sessionSnap = await sessionRef.get()
  if (sessionSnap.exists && sessionSnap.data().status === 'waiting') {
    batch.update(sessionRef, {
      status: firstPhase,
      phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()
}


/**
 * advancePhase
 *
 * Instructor-controlled advancement. Used for voting → survey → done.
 * Individual and group phase transitions happen automatically via
 * joinSession and autoGroupParticipants.
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

    if (nextPhase === 'group') {
      if (['waiting', 'individual', 'waiting_for_group'].includes(p.status)) {
        newStatus = 'group'
      }
    }

    if (nextPhase === 'voting') {
      if (p.status === 'group') newStatus = 'voting'
    }

    if (nextPhase === 'survey') {
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

  return { nextPhase }
})


/**
 * Shared phase sequence logic (mirrors frontend utils/phaseSequence.js).
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