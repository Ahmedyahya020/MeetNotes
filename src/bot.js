import puppeteer from 'puppeteer';
import { launch, getStream } from 'puppeteer-stream';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Detect meeting platform from URL.
 */
export function detectPlatform(url) {
  if (url.includes('meet.google.com')) return 'google-meet';
  if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
  throw new Error('Unsupported meeting platform. Use a Google Meet or Zoom link.');
}

/**
 * Join a meeting, record audio, return path to recorded file.
 */
export async function recordMeeting(meetingUrl, outputDir, onStatus) {
  const platform = detectPlatform(meetingUrl);
  onStatus(`Detected platform: ${platform}`);

  fs.mkdirSync(outputDir, { recursive: true });
  const audioPath = path.join(outputDir, 'recording.webm');

  const browser = await launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    headless: false, // needs to be visible to join meetings (Xvfb provides display on server)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream', // auto-allow mic/camera
      '--disable-web-security',
      '--allow-running-insecure-content',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  // Grant mic/camera permissions
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://meet.google.com', ['microphone', 'camera']);
  await context.overridePermissions('https://zoom.us', ['microphone', 'camera']);

  onStatus('Browser launched. Navigating to meeting...');

  if (platform === 'google-meet') {
    await joinGoogleMeet(page, meetingUrl, onStatus);
  } else {
    await joinZoom(page, meetingUrl, onStatus);
  }

  // Start recording audio stream
  onStatus('Starting audio recording...');
  const stream = await getStream(page, {
    audio: true,
    video: false,
    mimeType: 'audio/webm',
  });

  const fileStream = createWriteStream(audioPath);
  stream.pipe(fileStream);

  onStatus('Recording in progress. Waiting for meeting to end...');

  // Monitor for meeting end
  await waitForMeetingEnd(page, platform, onStatus);

  // Stop recording
  stream.destroy();
  await new Promise((resolve) => fileStream.on('finish', resolve));

  await browser.close();
  onStatus('Recording saved.');

  return audioPath;
}

async function joinGoogleMeet(page, url, onStatus) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Dismiss sign-in prompt if present — use guest/continue as guest
  try {
    await page.waitForSelector('input[type="text"]', { timeout: 5000 });
    await page.type('input[type="text"]', 'MeetNotes Bot');
  } catch {
    // No name field, already signed in
  }

  // Click "Join now" or "Ask to join"
  const joinSelectors = [
    '[data-idom-class="nCP5yc AjY5Oe DuMIQc LQeN7 jEvJeb QiObKb haAclf zUIzJd HuPDG"]',
    'button[jsname="Qx7uuf"]',
    '[aria-label="Join now"]',
    '[aria-label="Ask to join"]',
  ];

  for (const selector of joinSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 4000 });
      await page.click(selector);
      onStatus('Joined Google Meet.');
      return;
    } catch {
      continue;
    }
  }

  // Fallback: look for any button with join text
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const joinBtn = buttons.find(
      (b) => b.textContent.includes('Join') || b.textContent.includes('Ask to join')
    );
    if (joinBtn) joinBtn.click();
  });

  onStatus('Joined Google Meet.');
}

async function joinZoom(page, url, onStatus) {
  // Convert zoom.us/j/xxx links to web client links to avoid app redirect
  const webUrl = url
    .replace('zoom.us/j/', 'zoom.us/wc/')
    .replace('zoom.com/j/', 'zoom.us/wc/') + '/join';

  await page.goto(webUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Enter name
  try {
    await page.waitForSelector('#input-for-name, [placeholder="Your Name"]', { timeout: 8000 });
    await page.type('#input-for-name, [placeholder="Your Name"]', 'MeetNotes Bot');
  } catch {
    // already has name
  }

  // Click Join
  try {
    await page.waitForSelector('#joinBtn, .preview-join-button', { timeout: 5000 });
    await page.click('#joinBtn, .preview-join-button');
  } catch {
    await page.evaluate(() => {
      const btn = document.querySelector('[class*="join"]');
      if (btn) btn.click();
    });
  }

  onStatus('Joined Zoom meeting.');
}

async function waitForMeetingEnd(page, platform, onStatus) {
  const checkInterval = 10000; // check every 10 seconds
  const maxWait = 4 * 60 * 60 * 1000; // 4 hours max
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, checkInterval));

    try {
      const ended = await page.evaluate((p) => {
        if (p === 'google-meet') {
          // Meet shows "You left the meeting" or redirect to /lookingforsomething
          return (
            document.body.innerText.includes('You left the meeting') ||
            document.body.innerText.includes('left the meeting') ||
            window.location.href.includes('lookingforsomething')
          );
        } else {
          // Zoom web client shows meeting ended screen
          return (
            document.body.innerText.includes('The meeting has ended') ||
            document.body.innerText.includes('meeting is over')
          );
        }
      }, platform);

      if (ended) {
        onStatus('Meeting ended detected.');
        return;
      }
    } catch {
      // Page navigated, meeting likely ended
      onStatus('Meeting ended (page closed).');
      return;
    }
  }

  onStatus('Max recording time reached (4 hours). Stopping.');
}
