import React from 'react';
import { StyleSheet, View } from 'react-native';

import { readerThemes } from '../theme';
import type { ReaderThemeName } from '../types';

type Props = {
  fraction: number;
  markers: number[];
  label: string;
  viewportHeight: number;
  theme: (typeof readerThemes)[ReaderThemeName];
};

export function ReaderProgress({ fraction, markers, label, viewportHeight, theme }: Props) {
  // Stay below the top controls and above the bottom safe area in portrait
  // and landscape, without changing the reader's page height or text width.
  const availableHeight = Math.max(0, viewportHeight - 140);
  const height = Math.min(viewportHeight * 0.6, availableHeight);
  if (height <= 0) return null;

  const progress = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const percent = progress >= 1 ? 100 : Math.min(99, Math.round(progress * 100));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Book progress"
      accessibilityValue={{ min: 0, max: 100, now: percent, text: label }}
      pointerEvents="none"
      style={[styles.container, { height, top: 80 + (availableHeight - height) / 2 }]}
    >
      <View style={[styles.rail, { backgroundColor: theme.secondary + '40' }]} />
      <View style={[styles.fill, { height: progress * height, backgroundColor: theme.secondary }]} />
      {markers.map((position, index) => {
        // Crowded boundaries become tiny ticks at their true positions. Never
        // spread them apart: that would misrepresent the chapter lengths.
        const crowded = (position - (markers[index - 1] ?? -1)) * height < 8
          || ((markers[index + 1] ?? 2) - position) * height < 8;
        const completed = progress > 0 && position <= progress;
        return (
          <View
            key={position}
            style={[
              styles.marker,
              crowded && styles.tick,
              {
                top: position * height - (crowded ? 1 : 3),
                borderColor: theme.secondary,
                backgroundColor: completed ? theme.secondary : theme.background,
              },
            ]}
          />
        );
      })}
      {progress > 0 ? (
        <View style={[styles.endpoint, { top: progress * height - 1.5, backgroundColor: theme.secondary }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', right: 10, width: 12 },
  rail: { position: 'absolute', top: 0, bottom: 0, left: 5, width: 2, borderRadius: 1 },
  fill: { position: 'absolute', top: 0, left: 5, width: 2, borderRadius: 1 },
  marker: { position: 'absolute', left: 3, width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  tick: { left: 4, width: 4, height: 2, borderRadius: 1 },
  endpoint: { position: 'absolute', left: 1, width: 10, height: 3, borderRadius: 1.5 },
});
