// Port for the CUNEX LLE API. `LiveCunexClient` calls the real gateway,
// `MockCunexClient` serves fixture students until we get credentials.

// Only what the app keeps. CUNEX also sends names, title and email; those
// are dropped on purpose (data minimisation).
export interface CunexProfile {
  userId: string;
  /** Student id for students; null for staff or an unexpected format. */
  studentId: string | null;
  /** Staff id (8 digits) for staff; null for students. */
  staffId: string | null;
  /** Null when CUNEX gives no faculty (e.g. some staff accounts). */
  facultyCode: string | null;
  facultyNameTh: string;
  facultyNameEn: string;
  /** Entry year (พ.ศ.); null for staff. */
  studentYear: number | null;
}

export interface CunexNotification {
  /** CUNEX userId (not our user id) */
  userId: string;
  textTh: string;
  textEn?: string;
  /** Opened when the user taps the notification; CUNEX appends ?token= */
  callbackUrl?: string;
}

export interface NotificationReport {
  succeeded: number;
  failed: number;
}

export abstract class CunexClient {
  /** Exchanges a CUNEX login token for the student's profile. */
  abstract getProfile(token: string): Promise<CunexProfile>;

  /**
   * Where to send the browser for "เข้าสู่ระบบด้วยบัญชีจุฬาฯ". Null when no
   * "login with CUNEX" page is configured (only the app menu works then).
   */
  abstract loginUrl(options: { mockUser?: string }): string | null;

  /** UniversalLink that opens the CUNEX app at `callbackUrl` with a token. */
  abstract createShareLink(callbackUrl: string): Promise<string>;

  /** Push notifications; per-user quota failures are counted, not thrown. */
  abstract sendNotifications(
    items: CunexNotification[],
  ): Promise<NotificationReport>;
}
