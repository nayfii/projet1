import { BookOpenTextIcon, ChartGanttIcon, ChartLineIcon, CompassIcon, FlaskConicalIcon, FolderKanbanIcon } from "lucide-react";

/** Scale's six main entries (anything else lives in tabs inside them). Keys: g then the letter. */
export const SCALE_NAV = [
  { key: "overview", href: "/scale", icon: CompassIcon, exact: true, shortcut: "o" },
  { key: "roadmap", href: "/scale/roadmap", icon: ChartGanttIcon, exact: false, shortcut: "r" },
  { key: "projects", href: "/scale/projects", icon: FolderKanbanIcon, exact: false, shortcut: "p" },
  { key: "tests", href: "/scale/tests", icon: FlaskConicalIcon, exact: false, shortcut: "t" },
  { key: "strategy", href: "/scale/strategy", icon: BookOpenTextIcon, exact: false, shortcut: "s" },
  { key: "metrics", href: "/scale/metrics", icon: ChartLineIcon, exact: false, shortcut: "i" },
] as const;

export const SCALE_LAST_PATH = "cendr-space:scale";
export const PLATFORM_LAST_PATH = "cendr-space:platform";
