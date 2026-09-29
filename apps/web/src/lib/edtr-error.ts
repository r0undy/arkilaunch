import { ApiError, apiErrorText, payloadField } from './api-client.js';

export interface EdtrErrorExplanation {
  readonly title: string;
  readonly detail: string;
}

export function explainEdtrError(error: unknown): EdtrErrorExplanation {
  switch (payloadField(error, 'error')) {
    case 'reconciliation_not_found':
      return {
        title: 'No such reconciliation',
        detail:
          'Nothing in this tenant matches that reconciliation ID. Check it against the review queue -- a reconciliation belonging to another tenant is not visible here.',
      };
    case 'reconciliation_belongs_to_other_edtr':
      return {
        title: 'That reconciliation belongs to a different field log',
        detail: `It is attached to log ${String(payloadField(error, 'edtrId') ?? '').slice(0, 8)}. Approve it from that log.`,
      };
    case 'reconciliation_discrepancy':
      return {
        title: 'The two logs disagree',
        detail:
          'Nothing has been deducted. Enter both adjustment fields with the hours you are approving, then submit again -- a discrepancy can only clear on an explicit human decision.',
      };
    case 'already_approved':
      return {
        title: 'Already approved',
        detail: 'This pair was approved before, and the deposit was deducted then. Nothing changed just now.',
      };
    case 'not_approvable':
      return {
        title: 'Not ready to approve',
        detail:
          'This log has no counterpart yet, so there is nothing to reconcile against. A second, independently recorded log for the same machine and day has to arrive first.',
      };
    case 'deposit_exhausted':
      return {
        title: 'Deposit would go negative',
        detail: 'The deduction is larger than what is left on the deposit, so it was refused and no money moved.',
      };
    case 'rate_card_not_effective':
      return {
        title: 'No rate card covers that date',
        detail:
          'Rate cards exist for this equipment but none is effective on the report date, so the hours cannot be priced. Nothing was deducted.',
      };
    case 'line_items_required':
      return {
        title: 'Transcribed hours are needed',
        detail:
          'Automatic extraction is switched off in this environment, so a scanned sheet has to be accompanied by the hours read off it.',
      };
    case 'line_items_not_accepted':
      return {
        title: 'Remove the typed hours',
        detail:
          'Automatic extraction is enabled here, so the scan alone is captured and the hours come from the extractor.',
      };
    case 'report_date_outside_rental':
      return {
        title: 'That day is outside the rental',
        detail: 'Pick a day between the rental start and its return, or check the machine was on this rental that day.',
      };
    case 'site_not_assigned':
      return {
        title: 'You are not assigned to this site',
        detail: 'Ask the office to add you as a timekeeper for this site, then record the log again.',
      };
    case 'file_required':
      return { title: 'The scan is missing', detail: 'A paper log needs the photographed or uploaded sheet attached.' };
    default:
      return {
        title: 'That did not go through',
        // A plain Error is our own validation message; a TypeError is a raw network failure.
        detail:
          error instanceof ApiError
            ? apiErrorText(error)
            : error instanceof Error && error.name === 'Error'
              ? error.message
              : 'Try again in a moment.',
      };
  }
}
