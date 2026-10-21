/** Activity log filters: each category groups action codes by their prefix ("client.created" → "client."). */
export const ACTIVITY_CATEGORIES = {
  access: ["auth.", "invitation.", "member.", "company."],
  clients: ["client."],
  memory: ["memory.", "permissions."],
  protection: ["hide."],
  conversations: ["conversation."],
  agents: ["agent."],
  ai: ["ai.", "models.", "quota."],
  video: ["render."],
} as const;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;
export const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORIES) as ActivityCategory[];
export const isActivityCategory = (value: unknown): value is ActivityCategory => typeof value === "string" && value in ACTIVITY_CATEGORIES;

/** Periods offered by the filter, in days (null: everything). */
export const ACTIVITY_PERIODS = { "7": 7, "30": 30, "90": 90, all: null } as const;
export type ActivityPeriod = keyof typeof ACTIVITY_PERIODS;
