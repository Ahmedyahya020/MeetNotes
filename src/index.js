import 'dotenv/config';
import { getAuthenticatedClient } from './auth.js';
import { startAuthServer } from './server.js';
import { listRecentConferences, buildMeetingData, formatTranscriptForClaude } from './meet.js';
import { findCalendarEvent, extractEventMetadata } from './calendar.js';
import { generateRecap, buildRecapObject } from './claude.js';
import { createDoc, writeRecapToDoc } from './docs.js';

async function getAuth() {
  let auth = await getAuthenticatedClient();
  if (!auth) {
    console.log('No saved credentials found. Starting OAuth flow...');
    auth = await startAuthServer();
  }
  return auth;
}

async function run() {
  console.log('=== MeetNotes — Google Meet AI Notetaker ===\n');

  // 1. Authenticate
  const auth = await getAuth();
  console.log('Authenticated.\n');

  // 2. Fetch recent conference records
  console.log('Fetching recent Google Meet conferences (last 24h)...');
  const conferences = await listRecentConferences(auth, 24);

  if (conferences.length === 0) {
    console.log('No meetings found in the last 24 hours.');
    return;
  }

  console.log(`Found ${conferences.length} conference(s).\n`);

  // 3. Process each conference
  for (const conference of conferences) {
    console.log(`Processing: ${conference.name}`);

    // Build meeting data (participants + transcript)
    const meetingData = await buildMeetingData(auth, conference);

    // Try to find the matching Calendar event
    const meetingCode = conference.space?.meetingCode;
    const calendarEvent = meetingCode
      ? await findCalendarEvent(auth, meetingCode, 24)
      : null;
    const eventMetadata = extractEventMetadata(calendarEvent);

    const title = eventMetadata?.title || conference.name;
    console.log(`  Title: ${title}`);
    console.log(`  Transcript entries: ${meetingData.transcriptEntries.length}`);

    if (!meetingData.hasTranscript) {
      console.log('  No transcript available — generating recap from metadata only.\n');
    }

    // Format transcript for Claude
    const transcriptText = formatTranscriptForClaude(meetingData);

    // 4. Generate recap with Claude
    console.log('  Generating recap with Claude...');
    const parsed = await generateRecap(meetingData, eventMetadata, transcriptText);

    // 5. Build the recap document structure
    const recap = buildRecapObject(parsed, eventMetadata, meetingData, transcriptText, true);

    // 6. Create Google Doc
    const docTitle = `Meeting Recap: ${title} — ${recap.date}`;
    console.log(`  Creating Google Doc: "${docTitle}"...`);
    const { docId, url } = await createDoc(auth, docTitle);

    // 7. Write recap into the doc
    await writeRecapToDoc(auth, docId, recap);

    console.log(`  Done! Doc URL: ${url}\n`);
  }

  console.log('All meetings processed.');
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
