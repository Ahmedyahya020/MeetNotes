import { google } from 'googleapis';

const docs = google.docs('v1');
const drive = google.drive('v3');

/**
 * Create a new Google Doc with a title, return its ID and URL.
 */
export async function createDoc(auth, title) {
  const res = await docs.documents.create({
    auth,
    requestBody: { title },
  });
  const docId = res.data.documentId;
  return {
    docId,
    url: `https://docs.google.com/document/d/${docId}/edit`,
  };
}

/**
 * Write the recap content to an existing Google Doc.
 * Clears the doc first, then inserts structured content via batchUpdate.
 */
export async function writeRecapToDoc(auth, docId, recap) {
  // First read the doc to get current end index (to clear it)
  const docRes = await docs.documents.get({ auth, documentId: docId });
  const endIndex = docRes.data.body.content.at(-1)?.endIndex - 1 || 1;

  const requests = [];

  // Clear existing content if any
  if (endIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex },
      },
    });
  }

  // Build insert requests from the recap sections
  const lines = buildDocLines(recap);

  // Insert in reverse so indices stay valid (Google Docs inserts at index 1 each time)
  // Actually we insert a single block and use paragraph styles
  requests.push(...buildInsertRequests(lines));

  await docs.documents.batchUpdate({
    auth,
    documentId: docId,
    requestBody: { requests },
  });
}

/**
 * Convert the structured recap object into an ordered list of { text, style } lines.
 */
function buildDocLines(recap) {
  const lines = [];

  const push = (text, style = 'NORMAL_TEXT') => lines.push({ text, style });

  push(recap.title, 'HEADING_1');
  push('');
  push(`Date: ${recap.date}    Duration: ${recap.duration}    Organizer: ${recap.organizer}`);
  push(`Attendees: ${recap.attendees.join(', ')}`);
  push('');

  push('Summary', 'HEADING_2');
  push(recap.summary);
  push('');

  push('Key Discussion Points', 'HEADING_2');
  for (const point of recap.keyPoints) {
    push(`• ${point}`);
  }
  push('');

  push('Decisions Made', 'HEADING_2');
  for (const d of recap.decisions) {
    push(`• ${d}`);
  }
  push('');

  push('Action Items', 'HEADING_2');
  for (const item of recap.actionItems) {
    const owner = item.owner ? ` (${item.owner})` : '';
    const due = item.dueDate ? ` — due ${item.dueDate}` : '';
    push(`• ${item.task}${owner}${due}`);
  }
  push('');

  if (recap.nextSteps?.length) {
    push('Next Steps', 'HEADING_2');
    for (const step of recap.nextSteps) {
      push(`• ${step}`);
    }
    push('');
  }

  if (recap.transcript) {
    push('Full Transcript', 'HEADING_2');
    push(recap.transcript);
  }

  return lines;
}

/**
 * Convert lines into Google Docs batchUpdate insert + style requests.
 * We insert one big block of text, then apply paragraph styles.
 */
function buildInsertRequests(lines) {
  const requests = [];
  let index = 1;

  for (const { text, style } of lines) {
    const content = text + '\n';
    requests.push({
      insertText: {
        location: { index },
        text: content,
      },
    });

    if (style !== 'NORMAL_TEXT') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + content.length },
          paragraphStyle: { namedStyleType: style },
          fields: 'namedStyleType',
        },
      });
    }

    index += content.length;
  }

  return requests;
}

/**
 * Move a doc to a specific Drive folder (optional convenience).
 */
export async function moveDocToFolder(auth, docId, folderId) {
  const file = await drive.files.get({
    auth,
    fileId: docId,
    fields: 'parents',
  });

  const previousParents = file.data.parents.join(',');

  await drive.files.update({
    auth,
    fileId: docId,
    addParents: folderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });
}
