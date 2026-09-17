import { requireOptionalNativeModule } from 'expo';
import type { EyeTrackingNative } from './ReaderEyeTracking.types';

// Older development builds must continue to open books before a native rebuild.
export default requireOptionalNativeModule<EyeTrackingNative>('ReaderEyeTracking');
