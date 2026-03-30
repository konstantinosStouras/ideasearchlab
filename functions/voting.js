const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * submitVote
 *
 * Records a participant's votes. Each participant votes for exactly 3 ideas.
 * After all group members have voted, tallies votes and stores the top 3
 * on the group document, then moves all members to survey.
 *
 * data: { sessionId, ideaIds: [id, id, id] }
 */
exports.submitVote = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId, ideaIds } = data
  if (!sessionId || !Array.isArray(ideaIds) || ideaIds.length !== 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Must provide exactly 3 idea IDs.')
  }

  const uid = context.auth.uid
  const sessionRef = db.collection('sessions').doc(sessionId)

  // Get participant doc to find groupId
  const participantRef = sessionRef.collection('participants').doc(uid)
  const participantSnap = await participantRef.get()
  if (!participantSnap.exists) throw new functions.https.HttpsError('not-found', 'Participant not found.')

  const participant = participantSnap.data()
  const { groupId } = participant

  if (!groupId) throw new functions.https.HttpsError('failed-precondition', 'Participant has no group.')
  if (participant.votedFor) throw new functions.https.HttpsError('already-exists', 'Already voted.')

  // Record this participant's votes
  await participantRef.update({
    status: 'survey',
    votedFor: ideaIds,
    votedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Increment vote counts on each chosen idea
  const batch = db.batch()
  ideaIds.forEach(ideaId => {
    batch.update(sessionRef.collection('ideas').doc(ideaId), {
      votes: admin.firestore.FieldValue.increment(1),
    })
  })
  await batch.commit()

  // Check if all group members have voted
  const groupRef = sessionRef.collection('groups').doc(groupId)
  const groupSnap = await groupRef.get()
  const group = groupSnap.data()

  const membersSnap = await sessionRef.collection('participants')
    .where('groupId', '==', groupId)
    .get()

  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const allVoted = members.every(m => m.id === uid || m.votedFor)

  if (allVoted) {
    // Tally votes across all members and find top 3
    const voteMap = {}
    members.forEach(m => {
      const voted = m.id === uid ? ideaIds : (m.votedFor || [])
      voted.forEach(id => {
        voteMap[id] = (voteMap[id] || 0) + 1
      })
    })

    const top3 = Object.entries(voteMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)

    await groupRef.update({
      status: 'done',
      finalIdeas: top3,
      votingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  return { success: true, allVoted }
})
