const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

admin.initializeApp()

// Export each module's functions with europe-west1 region
const session = require('./session')
const grouping = require('./grouping')
const ai = require('./ai')
const voting = require('./voting')

exports.joinSession = session.joinSession
exports.advancePhase = session.advancePhase
exports.autoGroupParticipants = grouping.autoGroupParticipants
exports.handleStragglers = grouping.handleStragglers
exports.sendAIMessage = ai.sendAIMessage
exports.saveAISettings = ai.saveAISettings
exports.submitVote = voting.submitVote
exports.onParticipantUpdated = session.onParticipantUpdated