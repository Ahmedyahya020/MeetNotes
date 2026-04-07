import { google } from 'googleapis';

const meet = google.meet('v2');

/**
 * List conference records that ended within the last N hours.
 */
export async function listRecentConferences(auth, hoursBack = 24) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const res = await meet.conferenceRecords.list({
    auth,
    filter: `end_time>="${since}"`,
    pageSize: 25,
  });

  return res.data.conferenceRecords || [];
}

/**
 * List all transcripts for a conference record.
 */
export async function listTranscripts(auth, conferenceRecordName) {
  const res = await meet.conferenceRecords.transcripts.list({
    auth,
    parent: conferenceRecordName,
  });
  return res.data.transcripts || [];
}

/**
 * Fetch all transcript entries (the actual spoken lines) for a transcript.
 */
export async function getTranscriptEntries(auth, transcriptName) {
  const entries = [];
  let pageToken;

  do {
    const res = await meet.conferenceRecords.transcripts.entries.list({
      auth,
      parent: transcriptName,
      pageSize: 100,
      pageToken,
    });

    entries.push(...(res.data.transcriptEntries || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return entries;
}

/**
 * List participants for a conference record.
 */
export async function listParticipants(auth, conferenceRecordName) {
  const res = await meet.conferenceRecords.participants.list({
    auth,
    parent: conferenceRecordName,
  });
  return res.data.participants || [];
}

/**
 * Build a full transcript object: conference record + transcript entries + participants.
 */
export async function buildMeetingData(auth, conferenceRecord) {
  const participants = await listParticipants(auth, conferenceRecord.name);

  const transcripts = await listTranscripts(auth, conferenceRecord.name);

  let allEntries = [];
  for (const transcript of transcripts) {
    const entries = await getTranscriptEntries(auth, transcript.name);
    allEntries.push(...entries);
  }

  // Sort entries by startTime
  allEntries.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  return {
    conferenceRecord,
    participants,
    transcriptEntries: allEntries,
    hasTranscript: allEntries.length > 0,
  };
}

/**
 * Format transcript entries into a readable text block for Claude.
 */
export function formatTranscriptForClaude(meetingData) {
  const { transcriptEntries } = meetingData;

  return transcriptEntries
    .map((entry) => {
      const speaker = entry.participant?.signinUser?.displayName
        || entry.participant?.anonymousUser?.displayName
        || 'Unknown';
      const time = entry.startTime
        ? new Date(entry.startTime).toLocaleTimeString()
        : '';
      return `[${time}] ${speaker}: ${entry.text}`;
    })
    .join('\n');
}
