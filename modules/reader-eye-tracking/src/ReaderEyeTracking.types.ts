export type TrackingPhase = 'idle' | 'starting' | 'calibrating' | 'tracking' | 'paused' | 'error';
export type TrackingQuality = 'good' | 'low' | 'unavailable';

export type CameraVerification = {
  state: 'checking' | 'verified' | 'unavailable';
  cameraType: string;
  depthFrameCount: number;
  depthWidth?: number;
  depthHeight?: number;
};

/** Reader viewport in UIWindow points, before the passage's padding. */
export type CalibrationLayout = {
  readerX: number; readerY: number; readerWidth: number; readerHeight: number;
  fontSize: number; fontScale: number;
  foreground: string; background: string;
};

export type TrackingStatus = {
  sessionId: string;
  phase: TrackingPhase;
  quality: TrackingQuality;
  reason?: string;
  message?: string;
  /** Held-out calibration error in normalized window coordinates. */
  validationError?: number;
  cameraVerification?: CameraVerification;
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
  calibrate(sessionId: string, layout: CalibrationLayout): Promise<void>;
  addListener(event: 'onStatus', listener: (event: TrackingStatus) => void): { remove(): void };
}
