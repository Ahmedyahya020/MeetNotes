import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHUNK_DURATION = 600; // 10 minutes per chunk in seconds
const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB (Whisper limit is 25MB)

/**
 * Transcribe an audio file using OpenAI Whisper.
 * Automatically chunks if file is too large.
 */
export async function transcribeAudio(audioPath, onStatus) {
  onStatus('Preparing audio for transcription...');

  // Convert to mp3 first (smaller, better compatibility)
  const mp3Path = audioPath.replace('.webm', '.mp3');
  convertToMp3(audioPath, mp3Path);
  onStatus('Audio converted to MP3.');

  const fileSize = fs.statSync(mp3Path).size;
  onStatus(`Audio file size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

  let transcript;

  if (fileSize <= MAX_FILE_SIZE) {
    // Single request
    transcript = await whisperRequest(mp3Path, onStatus);
  } else {
    // Chunk and transcribe
    transcript = await transcribeInChunks(mp3Path, onStatus);
  }

  // Cleanup
  fs.unlinkSync(mp3Path);

  return transcript;
}

function convertToMp3(inputPath, outputPath) {
  execSync(`ffmpeg -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}" -y`, {
    stdio: 'ignore',
  });
}

function splitAudio(inputPath, outputDir, chunkDuration) {
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(
    `ffmpeg -i "${inputPath}" -f segment -segment_time ${chunkDuration} -c copy "${outputDir}/chunk_%03d.mp3" -y`,
    { stdio: 'ignore' }
  );
  return fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith('chunk_'))
    .sort()
    .map((f) => path.join(outputDir, f));
}

async function transcribeInChunks(mp3Path, onStatus) {
  const chunksDir = mp3Path.replace('.mp3', '_chunks');
  onStatus('File is large — splitting into chunks...');

  const chunks = splitAudio(mp3Path, chunksDir, CHUNK_DURATION);
  onStatus(`Split into ${chunks.length} chunks.`);

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    onStatus(`Transcribing chunk ${i + 1}/${chunks.length}...`);
    const text = await whisperRequest(chunks[i], onStatus);
    parts.push(text);
  }

  // Cleanup chunks
  fs.rmSync(chunksDir, { recursive: true, force: true });

  return parts.join('\n');
}

async function whisperRequest(filePath, onStatus) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'audio/mpeg',
  });
  form.append('model', 'whisper-1');
  // No language specified — Whisper auto-detects

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error: ${err}`);
  }

  const data = await res.json();
  return data.text;
}
