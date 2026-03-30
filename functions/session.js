const functions = require('firebase-functions')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * joinSession
 * Validates a session code and registers the participant.
 * Called from the JoinSession page (in addition to the direct Firestore write).
 * Acts as a server-side validation layer.
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

  // Register participant (merge: true so re-joins don't overwrite progress)
  await db
    .collection('sessions').doc(sessionId)
    .collection('participants').doc(context.auth.uid)
    .set({
      name: context.auth.token.name || context.auth.token.email,
      email: context.auth.token.email,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'waiting',
      individualComplete: false,
      groupId: null,
    }, { merge: true })

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
      // Only move waiting participants into individual
      if (p.status === 'waiting') newStatus = 'individual'
    }

    if (nextPhase === 'group' && session.phaseConfig?.phaseOrder === 'group_first') {
      // group_first: everyone starts in group phase, pre-assign groups
      if (p.status === 'waiting') newStatus = 'group'
    }

    if (nextPhase === 'survey') {
      // Push everyone who hasn't reached survey/done yet
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

  // If group_first, pre-assign groups now
  if (nextPhase === 'group' && session.phaseConfig?.phaseOrder === 'group_first') {
    await preAssignGroups(sessionId, participantsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  return { nextPhase }
})


/**
 * Pre-assigns groups when phaseOrder === 'group_first'.
 * Groups participants immediately without waiting for individual completion.
 */
async function preAssignGroups(sessionId, participants) {
  const sessionRef = db.collection('sessions').doc(sessionId)
  const shuffled = [...participants].sort(() => Math.random() - 0.5)
  const batch = db.batch()

  let i = 0
  while (i < shuffled.length) {
    const remaining = shuffled.length - i

    // Determine group size: 3, or 2 if only 2 left, skip if only 1 left
    let groupSize
    if (remaining === 1) {
      // 1 leftover: move directly to survey
      batch.update(
        sessionRef.collection('participants').doc(shuffled[i].id),
        { status: 'survey' }
      )
      i++
      continue
    } else if (remaining === 2) {
      groupSize = 2
    } else {
      groupSize = 3
    }

    const groupMembers = shuffled.slice(i, i + groupSize)
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

    i += groupSize
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
