import { google } from 'googleapis';

const calendar = google.calendar('v3');

/**
 * Find the Calendar event that matches a Google Meet conference ID / meeting code.
 */
export async function findCalendarEvent(auth, meetingCode, hoursBack = 24) {
  const timeMin = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const timeMax = new Date().toISOString();

  const res = await calendar.events.list({
    auth,
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  const events = res.data.items || [];

  return events.find((event) => {
    const confId = event.conferenceData?.conferenceId;
    const hangoutLink = event.hangoutLink || '';
    return confId === meetingCode || hangoutLink.includes(meetingCode);
  }) || null;
}

/**
 * Extract useful metadata from a Calendar event.
 */
export function extractEventMetadata(event) {
  if (!event) return null;

  const attendees = (event.attendees || []).map((a) => ({
    name: a.displayName || a.email,
    email: a.email,
    organizer: a.organizer || false,
    self: a.self || false,
  }));

  return {
    title: event.summary || 'Untitled Meeting',
    description: event.description || '',
    startTime: event.start?.dateTime || event.start?.date,
    endTime: event.end?.dateTime || event.end?.date,
    organizer: event.organizer?.displayName || event.organizer?.email || '',
    attendees,
    location: event.location || '',
    meetLink: event.hangoutLink || '',
  };
}
