import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export function saveToken(tokens) {
  // Always save to file (works locally and on paid Render with persistent disk)
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  } catch {
    // Filesystem not writable (e.g. free Render tier) — log so user can copy to env var
  }
  // Log token so it can be copied into the GOOGLE_TOKEN env var on Render
  console.log('\n=== GOOGLE_TOKEN (copy this into your Render env var) ===');
  console.log(JSON.stringify(tokens));
  console.log('==========================================================\n');
}

export function loadToken() {
  // 1. Try GOOGLE_TOKEN env var (works on free Render tier)
  if (process.env.GOOGLE_TOKEN) {
    try {
      return JSON.parse(process.env.GOOGLE_TOKEN);
    } catch { /* fall through */ }
  }
  // 2. Fall back to file (local dev or paid tier with persistent disk)
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

export async function getAuthenticatedClient() {
  const oauth2Client = createOAuth2Client();
  const tokens = loadToken();

  if (!tokens) return null;

  oauth2Client.setCredentials(tokens);

  // Auto-refresh if expired
  oauth2Client.on('tokens', (newTokens) => {
    const updated = { ...tokens, ...newTokens };
    saveToken(updated);
  });

  return oauth2Client;
}
