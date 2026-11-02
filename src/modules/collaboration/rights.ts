/** Rights in a shared conversation (CLAUDE.md §11). The owner has all of them and cannot be changed. */
export const PARTICIPANT_RIGHTS = ["reader", "participant", "manager"] as const;
export type ParticipantRight = (typeof PARTICIPANT_RIGHTS)[number];
export type ParticipantRole = ParticipantRight | "owner";
