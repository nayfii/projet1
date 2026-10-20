import type { AgentField } from "./definitions";

/** A translator for keys built at run time (tools.launch.<agent>.…); the i18n test checks they all exist. */
export type DynamicT = (key: string, values?: Record<string, string | number>) => string;

type Labelled = { builtinKey: string | null; name: string; description: string };

/**
 * What people see for a tool or agent: built-in agents are translated from their key, company tools
 * show what their creator wrote.
 */
export function agentText(agent: Labelled, t: DynamicT) {
  const base = agent.builtinKey ? `launch.${agent.builtinKey}` : null;
  return {
    name: base ? t(`${base}.name`) : agent.name,
    description: base ? t(`${base}.description`) : agent.description,
    field: (f: AgentField) => (base ? t(`${base}.fields.${f.key}`) : f.label),
    option: (f: AgentField, option: string) => (base ? t(`${base}.options.${f.key}.${option}`) : option),
  };
}
