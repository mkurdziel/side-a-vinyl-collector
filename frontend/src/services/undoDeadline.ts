const deadlineTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function formatUndoDeadline(expiresAt: string): string {
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) ? deadlineTime.format(timestamp) : '';
}
