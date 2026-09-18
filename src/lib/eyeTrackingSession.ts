import type { CalibrationLayout, EyeTrackingNative, TrackingCapabilities, TrackingStatus } from '../../modules/reader-eye-tracking/src/ReaderEyeTracking.types';

export type EyeTrackingState = TrackingStatus & { enabled: boolean; calibrated: boolean; busy: boolean };
export const initialEyeTrackingState: EyeTrackingState = {
  sessionId: '', enabled: false, calibrated: false, busy: false, phase: 'idle', quality: 'unavailable',
};
let nextSession = 0;

/** Owns camera intent independently of React renders and native callback timing. */
export class EyeTrackingSession {
  readonly id = `reader-gaze-${Date.now()}-${++nextSession}`;
  readonly capabilities: TrackingCapabilities;
  state: EyeTrackingState = { ...initialEyeTrackingState, sessionId: this.id };
  private blockers = new Set<string>();
  private leases = new Set<symbol>();
  private commands: Promise<void> = Promise.resolve();
  private disposed = false;
  private operation = 0;
  private subscription?: { remove(): void };

  constructor(private readonly native: EyeTrackingNative | null, private readonly onChange: (state: EyeTrackingState) => void) {
    this.capabilities = native?.getCapabilities() ?? {
      available: false, reason: 'Rebuild the iOS app to try eye tracking on a Face ID iPhone.',
    };
  }

  connect(): void {
    if (!this.disposed && !this.subscription) this.subscription = this.native?.addListener('onStatus', status => {
      if (this.disposed || !this.state.enabled || status.sessionId !== this.id) return;
      // A queued frame/status must not undo an explicit camera suspension.
      if (!this.canRun && (status.phase === 'tracking' || status.phase === 'starting')) return;
      // Suspending for the settings panel must retain actionable recovery, such
      // as Open Settings after camera permission was denied.
      if (this.state.phase === 'error' && status.phase === 'paused') return;
      this.publish({ reason: undefined, message: undefined, ...status });
      if (status.reason === 'interruptionEnded' && this.state.calibrated && this.canRun) {
        void this.reconcile().catch(error => this.reportError(error));
      }
    });
  }

  private get canRun(): boolean {
    return !this.disposed && this.state.enabled && (this.state.busy || this.state.calibrated)
      && this.state.phase !== 'error' && this.blockers.size === 0 && this.leases.size === 0;
  }

  private publish(update: Partial<EyeTrackingState>): void {
    this.state = { ...this.state, ...update };
    if (!this.disposed) this.onChange(this.state);
  }

  private reportError(error: unknown): void {
    if (this.disposed || !this.state.enabled) return;
    const code = (error as { code?: string })?.code;
    const message = (error as { message?: string })?.message;
    this.publish({ phase: 'error', quality: 'unavailable', reason: code,
      message: code === 'ERR_GAZE_PERMISSION'
        ? 'Allow camera access in Settings to use eye tracking.'
        : code?.startsWith('ERR_GAZE_') && typeof message === 'string' && message.length > 0
          ? message : 'Eye tracking could not start. Try calibrating again.' });
  }

  private reconcile(): Promise<void> {
    if (!this.canRun && this.native) {
      // Cancellation must reach native immediately, including while start is
      // waiting for camera permission. Native invalidates that start's epoch.
      // Still join the old command before granting the scanner its lease.
      const suspension = this.disposed || !this.state.enabled ? this.native.stop(this.id) : this.native.pause(this.id);
      const task = Promise.all([this.commands.catch(() => {}), suspension]).then(() => {});
      this.commands = task;
      return task;
    }
    // Read intent when each short camera command executes, not when it is queued.
    const task = this.commands.catch(() => {}).then(async () => {
      if (!this.native) return;
      if (this.disposed || !this.state.enabled) await this.native.stop(this.id);
      else if (this.canRun) await this.native.start(this.id);
      else await this.native.pause(this.id);
    });
    this.commands = task;
    return task;
  }

  setBlocked(reason: string, blocked: boolean): void {
    if (this.disposed || this.blockers.has(reason) === blocked) return;
    if (blocked) this.blockers.add(reason); else this.blockers.delete(reason);
    if (this.state.enabled) void this.reconcile().catch(error => this.reportError(error));
  }

  setApplicationState(value: string): void {
    // Permission UI produces a transient inactive event. Native start waits for
    // active before resolving; blocking it here can drop the calibration intent.
    if (value === 'inactive' && this.state.busy && this.state.phase === 'starting') return;
    const wasBlocked = this.blockers.has('background');
    this.setBlocked('background', value !== 'active');
    // Native also pauses on resign-active, independently of JS, so reconcile
    // every foreground transition even if no JS blocker was installed.
    if (value === 'active' && !wasBlocked && this.state.enabled) {
      void this.reconcile().catch(error => this.reportError(error));
    }
  }

  async calibrate(layout: CalibrationLayout): Promise<void> {
    if (this.disposed || this.state.busy || !this.capabilities.available || !this.native) return;
    const operation = ++this.operation;
    this.publish({ enabled: true, calibrated: false, busy: true, phase: 'starting', reason: undefined, message: undefined, cameraVerification: undefined });
    try {
      await this.reconcile();
      if (!this.canRun || operation !== this.operation) return;
      // Do not put this long-lived presentation on the command queue: background,
      // scanner acquisition and disable must be able to cancel it immediately.
      await this.native.calibrate(this.id, layout);
      if (!this.disposed && this.state.enabled && operation === this.operation) {
        this.publish({ calibrated: true });
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (operation === this.operation && this.state.enabled) {
        if (code === 'ERR_GAZE_CANCELLED' || code === 'ERR_GAZE_BACKGROUND' || code === 'ERR_GAZE_INTERRUPTED') {
          this.publish({ phase: 'paused', quality: 'unavailable', message: 'Calibration paused. Open reading settings to try again.' });
        } else this.reportError(error);
      }
    } finally {
      if (!this.disposed && operation === this.operation) {
        this.publish({ busy: false });
        if (!this.canRun) void this.reconcile().catch(() => {});
      }
    }
  }

  disable(): void {
    if (this.disposed) return;
    this.operation++;
    this.publish({ ...initialEyeTrackingState, sessionId: this.id, cameraVerification: undefined, validationError: undefined, reason: undefined, message: undefined });
    void this.reconcile().catch(() => {});
  }

  async acquireCamera(): Promise<() => void> {
    const lease = Symbol('scanner-camera');
    this.leases.add(lease);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.leases.delete(lease);
      void this.reconcile().catch(error => this.reportError(error));
    };
    try {
      // Resolves only after native capture is paused/stopped, even if a previous
      // start was waiting for the camera permission dialog.
      await this.reconcile();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operation++;
    this.subscription?.remove();
    this.subscription = undefined;
    void this.reconcile().catch(() => {});
  }
}
