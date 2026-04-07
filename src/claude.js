import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a structured meeting recap from a transcript.
 */
export async function generateRecap(transcript, meetingMeta) {
  const metaBlock = meetingMeta
    ? `Meeting URL: ${meetingMeta.url}
Platform: ${meetingMeta.platform}
Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
    : '';

  const prompt = `You are a professional meeting notes assistant. Analyze the transcript below and produce a structured recap.

${metaBlock}

TRANSCRIPT:
${transcript}

Respond with a JSON object (raw JSON only, no markdown) in exactly this format:
{
  "title": "Short descriptive meeting title based on content",
  "language": "detected language name in English (e.g. English, Arabic, French)",
  "summary": "2-4 sentence executive summary",
  "keyPoints": ["point 1", "point 2"],
  "decisions": ["decision 1", "decision 2"],
  "actionItems": [
    { "task": "description", "owner": "person name or null", "dueDate": "date string or null" }
  ],
  "nextSteps": ["step 1", "step 2"]
}

Rules:
- Write the summary, key points, decisions, action items in the SAME language as the transcript
- Be concise and professional
- keyPoints: 3-7 most important topics
- decisions: concrete decisions made (empty array if none)
- actionItems: tasks with owners and deadlines where mentioned`;

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${text}`);
  }
}
