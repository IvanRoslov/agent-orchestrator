export interface ResourceRow {
  tmuxSession: string;
  sessionId: string | null;
  projectId: string | null;
  known: boolean;
  orphan: boolean;
  aoStatus: string | null;
  cpuPercent: number | null;
  rssMb: number | null;
  procCount: number;
  topCommand: string;
  ageMinutes: number;
  idleMinutes: number | null;
}

export interface ResourceSnapshot {
  capturedAt: string;
  platformSupported: boolean;
  sessions: ResourceRow[];
  totals: {
    cpuPercent: number;
    rssMb: number;
    procCount: number;
    sessionCount: number;
  };
}
