/**
 * Employee Dashboard - Constants
 * @module employee-dashboard/_lib/constants
 */

import { DEFAULT_HIERARCHY_LABELS, type HierarchyLabels } from '$lib/types/hierarchy-labels';

/** List display limits */
export const LIST_LIMITS = {
  recentDocuments: 5,
  upcomingEvents: 3,
  blackboardEntries: 5,
} as const;

/** Calendar fetch range in months */
export const CALENDAR_MONTHS_AHEAD = 3;

/** Floating dots count for hero animation */
export const FLOATING_DOTS_COUNT = 24;

/** Factory: org level display text with dynamic hierarchy labels */
export function createOrgLevelText(labels: HierarchyLabels): Record<string, string> {
  return {
    company: 'Firma',
    department: labels.department,
    team: labels.team,
    area: labels.area,
    personal: 'Persönlich',
  };
}

/** Backward-compatible static export */
export const ORG_LEVEL_TEXT: Record<string, string> = createOrgLevelText(DEFAULT_HIERARCHY_LABELS);

/** Quick access card routes */
export const QUICK_ACCESS_ROUTES = {
  documents: '/documents-explorer',
  calendar: '/calendar',
  kvp: '/kvp',
  profile: '/employee-profile',
} as const;

/** Default placeholder text */
export const PLACEHOLDER_TEXT = {
  notAssigned: 'Nicht zugewiesen',
  noDocuments: 'Keine Dokumente vorhanden',
  noEvents: 'Keine anstehenden Termine',
  loading: 'Lade...',
  loadingEntries: 'Lade Einträge...',
  employee: 'Mitarbeiter',
} as const;

/** UI Messages (German) */
export const MESSAGES = {
  welcomeBack: 'Willkommen zurück!',
  niceToSeeYou: 'Schön, dass Sie da sind,',
  upcomingEvents: 'Nächste Termine',
  noBlackboard: 'Keine Einträge',
  noBlackboardDescription: 'Das Schwarze Brett ist derzeit leer.',
  unknownAuthor: 'Unbekannt',
  allDay: 'Ganztägig',
  unknownEvent: 'Unbenannter Termin',
  documentsCardTitle: 'Meine Dokumente',
  documentsButton: 'Dokumente öffnen',
  calendarCardTitle: 'Kalender',
  calendarButton: 'Kalender öffnen',
  kvpCardTitle: 'Verbesserungsvorschläge',
  kvpButton: 'KVP öffnen',
  kvpDescription: 'Teilen Sie Ihre Ideen zur Verbesserung',
  profileCardTitle: 'Mein Profil',
  profileButton: 'Profil bearbeiten',
  profileDescription: 'Persönliche Einstellungen verwalten',
  // No-team hint card (shown when the current user has no user_teams entry).
  // WHY: Admin/Root users have no team membership by design (ADR-010 — they
  // manage via has_full_access + admin_*_permissions, not via user_teams).
  // When they role-switch to employee view, the 3 lead/team cards would be
  // empty. Replace with a single honest hint card instead of fake data.
  noTeamHintTitle: 'Keine Team-Zuordnung',
  noTeamHintAdmin:
    'Diese Ansicht ist für Mitarbeiter konzipiert. Als Admin/Root haben Sie keine direkte Team-Mitgliedschaft — Sie verwalten via Lead-Positionen und Vollzugriff.',
  noTeamHintEmployee:
    'Sie wurden noch keinem Team zugeordnet. Bitte kontaktieren Sie Ihren Administrator.',
} as const;

/** Priority labels (German) */
export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  urgent: 'Dringend',
} as const;

/** Factory: blackboard org level labels with dynamic hierarchy labels */
export function createBlackboardOrgLabels(labels: HierarchyLabels): Record<string, string> {
  return {
    company: 'Firma',
    department: labels.department,
    team: labels.team,
    area: labels.area,
  };
}

/** Backward-compatible static export */
export const BLACKBOARD_ORG_LABELS: Record<string, string> =
  createBlackboardOrgLabels(DEFAULT_HIERARCHY_LABELS);
