import 'dotenv/config';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { recordMeeting, detectPlatform } from './bot.js';
import { transcribeAudio } from './transcribe.js';
import { generateRecap } from './claude.js';
import { createDoc, writeRecapToDoc } from './docs.js';
import { getAuthenticatedClient } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');
const RECAPS_FILE = path.join(DATA_DIR, 'recaps.json');

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// In-memory job store
const jobs = {};

// Load saved recaps
function loadRecaps() {
  if (!fs.existsSync(RECAPS_FILE)) return [];
  return JSON.parse(fs.readFileSync(RECAPS_FILE, 'utf8'));
}

function saveRecap(recap) {
  const recaps = loadRecaps();
  recaps.unshift(recap); // newest first
  fs.writeFileSync(RECAPS_FILE, JSON.stringify(recaps.slice(0, 50), null, 2)); // keep last 50
}

function logJob(jobId, msg) {
  if (!jobs[jobId]) return;
  const time = new Date().toLocaleTimeString();
  console.log(`[${jobId.slice(0, 6)}] ${msg}`);
  jobs[jobId].logs.push({ time, msg });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// POST /api/record — start a new recording job
app.post('/api/record', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let platform;
  try {
    platform = detectPlatform(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = uuidv4();
  jobs[jobId] = { status: 'running', logs: [], platform, url };

  res.json({ jobId });

  // Run async pipeline
  runPipeline(jobId, url, platform);
});

// GET /api/status/:jobId
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// GET /api/recent
app.get('/api/recent', (_req, res) => {
  res.json(loadRecaps());
});

async function runPipeline(jobId, url, platform) {
  const outputDir = path.join(RECORDINGS_DIR, jobId);

  try {
    // 1. Get Google auth (for Docs)
    logJob(jobId, 'Authenticating with Google...');
    let auth = await getAuthenticatedClient();
    if (!auth) {
      logJob(jobId, 'No Google token found — please authorize first at /auth');
      jobs[jobId].status = 'error';
      jobs[jobId].error = 'Not authenticated with Google. Visit /auth first.';
      return;
    }

    // 2. Join meeting and record
    logJob(jobId, `Joining ${platform === 'google-meet' ? 'Google Meet' : 'Zoom'}...`);
    const audioPath = await recordMeeting(url, outputDir, (msg) => logJob(jobId, msg));

    // 3. Transcribe
    logJob(jobId, 'Transcribing audio with Whisper...');
    const transcript = await transcribeAudio(audioPath, (msg) => logJob(jobId, msg));
    logJob(jobId, `Transcript: ${transcript.split(' ').length} words`);

    // 4. Generate recap with Claude
    logJob(jobId, 'Generating recap with Claude...');
    const recap = await generateRecap(transcript, { url, platform });

    // 5. Create Google Doc
    logJob(jobId, 'Creating Google Doc...');
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const docTitle = `${recap.title} — ${date}`;
    const { docId, url: docUrl } = await createDoc(auth, docTitle);

    await writeRecapToDoc(auth, docId, {
      title: recap.title,
      date,
      duration: '',
      organizer: '',
      attendees: [],
      summary: recap.summary,
      keyPoints: recap.keyPoints || [],
      decisions: recap.decisions || [],
      actionItems: recap.actionItems || [],
      nextSteps: recap.nextSteps || [],
      transcript,
    });

    logJob(jobId, `Done! Google Doc created.`);

    jobs[jobId].status = 'done';
    jobs[jobId].docUrl = docUrl;
    jobs[jobId].title = recap.title;

    saveRecap({ title: recap.title, docUrl, date, platform });

    // Cleanup recording
    fs.rmSync(outputDir, { recursive: true, force: true });

  } catch (err) {
    console.error(`Job ${jobId} failed:`, err);
    logJob(jobId, `Error: ${err.message}`);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

// Google OAuth routes
app.get('/auth', async (_req, res) => {
  const { getAuthUrl, createOAuth2Client } = await Promise.resolve(import('./auth.js'));
  const oauth2Client = createOAuth2Client();
  const url = getAuthUrl(oauth2Client);
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { createOAuth2Client, saveToken } = await import('./auth.js');
  const { code, error } = req.query;

  if (error) return res.send(`Authorization failed: ${error}`);

  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveToken(tokens);

  res.send(`
    <html><body style="font-family:sans-serif;padding:2rem;text-align:center">
      <h2>✅ Google authorization successful!</h2>
      <p><a href="/">Go back to MeetNotes →</a></p>
    </body></html>
  `);
});

app.listen(PORT, () => {
  console.log(`\nMeetNotes running at http://localhost:${PORT}`);
  console.log(`First time? Authorize Google at http://localhost:${PORT}/auth\n`);
});
