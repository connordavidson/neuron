import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import ReaderEyeTracking from '../../modules/reader-eye-tracking/src/ReaderEyeTrackingModule';
import type { CalibrationLayout } from '../../modules/reader-eye-tracking/src/ReaderEyeTracking.types';
import { EyeTrackingSession, initialEyeTrackingState } from '../lib/eyeTrackingSession';

export function useEyeTracking(panelOpen: boolean, scannerActive: boolean) {
  const [state, setState] = useState(initialEyeTrackingState);
  const controller = useRef<EyeTrackingSession | null>(null);
  if (controller.current == null) controller.current = new EyeTrackingSession(ReaderEyeTracking, setState);
  const session = controller.current;

  useEffect(() => {
    session.connect();
    session.setApplicationState(AppState.currentState ?? 'active');
    const subscription = AppState.addEventListener('change', value => session.setApplicationState(value));
    return () => { subscription.remove(); session.dispose(); };
  }, [session]);
  useEffect(() => { session.setBlocked('panel', panelOpen); }, [session, panelOpen]);
  useEffect(() => { session.setBlocked('scanner', scannerActive); }, [session, scannerActive]);

  const calibrate = useCallback((layout: CalibrationLayout) => {
    // Caller closes the settings panel in the same event. Release its blocker
    // now, before the effect for that render, to avoid missing the start intent.
    session.setBlocked('panel', false);
    void session.calibrate(layout);
  }, [session]);
  const disable = useCallback(() => session.disable(), [session]);
  const acquireCamera = useCallback(() => session.acquireCamera(), [session]);
  return { state, sessionId: session.id, capabilities: session.capabilities, calibrate, disable, acquireCamera };
}
