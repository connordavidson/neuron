export type TrackingPhase = 'idle' | 'starting' | 'calibrating' | 'tracking' | 'paused' | 'error';
export type TrackingQuality = 'good' | 'low' | 'unavailable';

export type TrackingStatus = {
  sessionId: string;
  phase: TrackingPhase;
  quality: TrackingQuality;
  reason?: string;
  message?: string;
  /** Held-out calibration error in normalized window coordinates. */
  validationError?: number;
};

export type TrackingCapabilities = { available: boolean; reason?: string };
export type WordEstimate = {
  sessionId: string;
  passageId: string;
  layoutRevision: string;
  /** Half-open UTF-16 range in the displayed passage, never PDF offsets. */
  start: number;
  end: number;
  quality: TrackingQuality;
};

export interface EyeTrackingNative {
  getCapabilities(): TrackingCapabilities;
  start(sessionId: string): Promise<void>;
  pause(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  calibrate(sessionId: string): Promise<void>;
  addListener(event: 'onStatus', listener: (event: TrackingStatus) => void): { remove(): void };
}
