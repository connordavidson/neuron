import React, { useRef, useState } from 'react';
import { requireNativeView } from 'expo';
import { useWindowDimensions, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import ReaderEyeTracking from './ReaderEyeTrackingModule';
import type { WordEstimate } from './ReaderEyeTracking.types';

type NativeProps = ViewProps & {
  text: string; fontSize: number; fontScale: number; textColor: string;
  sessionId: string; passageId: string; layoutRevision: string; trackingActive: boolean;
  pageIndex: number; pageHeight: number;
  onTextLayout: (event: NativeSyntheticEvent<{ height: number; layoutRevision: string }>) => void;
  onWordChange?: (event: NativeSyntheticEvent<WordEstimate>) => void;
  onPress: () => void;
};
const NativeGazeText = ReaderEyeTracking ? requireNativeView<NativeProps>('ReaderEyeTracking') : null;

type Props = Omit<NativeProps, 'fontScale' | 'onTextLayout' | 'style'>;
export function ReaderGazeText(props: Props) {
  const { fontScale, width } = useWindowDimensions();
  const revision = `${props.layoutRevision}:${props.fontSize}:${fontScale}:${width}`;
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  const [measurement, setMeasurement] = useState({ revision: '', height: 1 });
  if (!NativeGazeText) return null;
  return <NativeGazeText
    {...props}
    fontScale={fontScale}
    layoutRevision={revision}
    onWordChange={event => {
      if (event.nativeEvent.layoutRevision === currentRevision.current) props.onWordChange?.(event);
    }}
    style={{ width: '100%', maxWidth: 700, height: measurement.revision === revision ? measurement.height : 1 }}
    onTextLayout={event => {
      const { height, layoutRevision } = event.nativeEvent;
      if (layoutRevision === currentRevision.current && Number.isFinite(height) && height > 0) {
        setMeasurement(previous => previous.revision === revision && previous.height === height
          ? previous : { revision, height });
      }
    }}
  />;
}
