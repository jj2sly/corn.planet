// Types for content.js: every line of text Cold Case shows.

export declare const TEXT: {
  title: string;
  kicker: string;
  briefing: { file: string; site: string; situation: string; objectives: readonly string[]; notes: readonly string[] };
  controls: { keyboard: readonly [string, string][]; touch: readonly [string, string][] };
  objectives: Readonly<Record<string, string>>;
  stations: Readonly<Record<string, string>>;
  doors: Readonly<Record<string, string>>;
  messages: Readonly<Record<string, string>>;
  chuck: { speaker: string; lines: readonly string[] };
  debrief: { heading: string; status: string };
};
