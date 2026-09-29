// Release 1 F1/F6 HTTP contract. Type-only while server and dashboard migrate
// gradually from JavaScript; bearer links must never appear in roster/history.
export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
export type LinkPurpose = 'reveal' | 'copy';
export interface PersonalLinkPermission {
  minimumRole: OrganizationRole;
  canReveal: boolean;
  canResend: boolean;
  canConfigure: boolean;
}
export interface PersonalLinkRequest { purpose: LinkPurpose }
export interface PersonalLinkResponse { link: string }
export interface ScheduleUpdate {
  startLocal: string; // YYYY-MM-DDTHH:mm in timezone
  closeLocal: string;
  timezone: string; // IANA identifier, e.g. America/New_York
  reminderEveryDays: number; // integer 1..30, local calendar days
  expectedVersion: number; // 0 for new, current version for edits
}
export type ScheduleKind = 'initial' | 'reminder' | 'close';
export type ScheduleStatus = 'active' | 'cancelled' | 'completed';
export interface DeliverySchedule {
  id: string;
  surveyId: string;
  timezone: string;
  startLocal: string;
  closeLocal: string;
  startAt: string; // ISO UTC
  closeAt: string;
  reminderEveryDays: number;
  nextDueAt: string;
  nextKind: ScheduleKind;
  status: ScheduleStatus;
  occurrence: number;
  version: number;
}
export interface ScheduleResponse { schedule: DeliverySchedule | null }
export interface ScheduleCancellation { status: 'cancelled'; version: number }
export interface DeliveryLaunchResponse {
  launch: { id: string; survey_id: string; kind: 'initial' | 'reminder'; replayed: boolean };
  lifecycleStatus: 'active' | 'draft' | 'closed';
  message: string;
}
// Routes (base /api):
// GET/PUT /surveys/:surveyId/personal-link-permission
// POST /surveys/:surveyId/respondents/:respondentId/personal-link
// POST /surveys/:surveyId/respondents/:respondentId/resend (Idempotency-Key UUID)
// GET/PUT/DELETE /surveys/:surveyId/delivery-schedule
