import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { readerThemes } from '../theme';
import type { BookContent, Chapter, ContextualSupplement, ReaderPreferences, ReaderThemeName } from '../types';
import { styles } from './readerStyles';
type Theme = (typeof readerThemes)[ReaderThemeName];
type PanelProps = { activeTheme: Theme; preferences: ReaderPreferences; onClose: () => void };

export function ChaptersPanel({ activeTheme, preferences, onClose, navigationStart, goToParagraph, updatingChapters, content, currentChapter }: PanelProps & { navigationStart: number; goToParagraph: (index: number) => void; updatingChapters: boolean; content: BookContent; currentChapter: Chapter | undefined }) {
  return (
    <View
            style={[
              styles.chapterPanel,
              {
                backgroundColor: preferences.theme === 'night' ? '#1B1D24' : '#FFFFFF',
                borderColor: activeTheme.secondary + '30',
              },
            ]}
          >
            <View style={styles.settingsHeader}>
              <Text style={[styles.settingsTitle, { color: activeTheme.foreground }]}>Chapters</Text>
              <Pressable accessibilityLabel="Close chapters" onPress={onClose}>
                <Text style={[styles.doneButton, { color: activeTheme.secondary }]}>Done</Text>
              </Pressable>
            </View>
            {navigationStart > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => goToParagraph(navigationStart)}
                style={({ pressed }) => [styles.startReadingRow, pressed && styles.controlPressed]}
              >
                <Text style={[styles.startReadingTitle, { color: activeTheme.foreground }]}>Start reading</Text>
                <Text style={[styles.startReadingBody, { color: activeTheme.secondary }]}>Skip front matter</Text>
              </Pressable>
            ) : null}
            {updatingChapters ? <Text style={[styles.chapterMeta, { color: activeTheme.secondary }]}>Finding chapters…</Text> : null}
            <ScrollView showsVerticalScrollIndicator={false} style={styles.chapterList}>
              {content.chapters.length ? (
                content.chapters.map((chapter) => (
                  <Pressable
                    accessibilityLabel={`Jump to ${chapter.title}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chapter === currentChapter }}
                    key={`${chapter.pageIndex ?? 0}-${chapter.paragraphIndex}-${chapter.title}`}
                    onPress={() => goToParagraph(chapter.paragraphIndex)}
                    style={({ pressed }) => [styles.chapterRow, { marginLeft: Math.min(28, (chapter.level ?? 0) * 10) },
                      chapter === currentChapter && { backgroundColor: activeTheme.foreground + '0D' },
                      pressed && styles.controlPressed]}
                  >
                    <Text style={[styles.chapterTitle, { color: activeTheme.foreground }, chapter.kind === 'part' && { fontWeight: '800' }]}>
                      {chapter.title}
                    </Text>
                    <Text style={[styles.chapterMeta, { color: activeTheme.secondary }]}>
                      {chapter.pageIndex != null ? `PDF page ${chapter.pageIndex + 1}` : `Reading page ${chapter.paragraphIndex + 1}`}
                      {chapter === currentChapter ? ' · Reading now' : ''}
                    </Text>
                  </Pressable>
                ))
              ) : (
                !updatingChapters && <Text style={[styles.noChapters, { color: activeTheme.secondary }]}>No reliable chapters found in this PDF</Text>
              )}
            </ScrollView>
          </View>
  );
}

export function ContextPanel({ activeTheme, preferences, onClose, currentSupplements }: PanelProps & { currentSupplements: ContextualSupplement[] }) {
  return (
    <View
            style={[
              styles.contextPanel,
              {
                backgroundColor: preferences.theme === 'night' ? '#1B1D24' : '#FFFFFF',
                borderColor: activeTheme.secondary + '30',
              },
            ]}
          >
            <View style={styles.settingsHeader}>
              <Text style={[styles.settingsTitle, { color: activeTheme.foreground }]}>Notes and context</Text>
              <Pressable accessibilityLabel="Close notes" onPress={onClose}>
                <Text style={[styles.doneButton, { color: activeTheme.secondary }]}>Done</Text>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.chapterList}>
              {currentSupplements.map((supplement) => (
                <View key={supplement.id} style={styles.supplementRow}>
                  <Text style={[styles.supplementKind, { color: activeTheme.secondary }]}>{supplement.kind}</Text>
                  <Text selectable style={[styles.supplementText, { color: activeTheme.foreground }]}>{supplement.text}</Text>
                  <Text style={[styles.chapterMeta, { color: activeTheme.secondary }]}>PDF page {supplement.anchor.pageIndex + 1}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
  );
}

export function SettingsPanel({ activeTheme, preferences, onClose, onPreferencesChange, themeOptions, onImproveParsing, isImprovingParsing }: PanelProps & { onPreferencesChange: (preferences: ReaderPreferences) => void; themeOptions: [ReaderThemeName, Theme][]; onImproveParsing?: () => void; isImprovingParsing: boolean }) {
  return (
    <View
            style={[
              styles.settingsPanel,
              {
                backgroundColor: preferences.theme === 'night' ? '#1B1D24' : '#FFFFFF',
                borderColor: activeTheme.secondary + '30',
              },
            ]}
          >
            <View style={styles.settingsHeader}>
              <Text style={[styles.settingsTitle, { color: activeTheme.foreground }]}>Reading</Text>
              <Pressable
                accessibilityLabel="Close reading settings"
                onPress={onClose}
              >
                <Text style={[styles.doneButton, { color: activeTheme.secondary }]}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.sizeRow}>
              <Pressable
                accessibilityLabel="Decrease text size"
                disabled={preferences.fontSize <= 18}
                onPress={() =>
                  onPreferencesChange({
                    ...preferences,
                    fontSize: Math.max(18, preferences.fontSize - 2),
                  })
                }
                style={({ pressed }) => [
                  styles.sizeButton,
                  { borderColor: activeTheme.secondary + '40' },
                  pressed && styles.controlPressed,
                ]}
              >
                <Text style={[styles.sizeSmall, { color: activeTheme.foreground }]}>A</Text>
              </Pressable>
              <Text style={[styles.sizeValue, { color: activeTheme.secondary }]}>
                {preferences.fontSize}
              </Text>
              <Pressable
                accessibilityLabel="Increase text size"
                disabled={preferences.fontSize >= 32}
                onPress={() =>
                  onPreferencesChange({
                    ...preferences,
                    fontSize: Math.min(32, preferences.fontSize + 2),
                  })
                }
                style={({ pressed }) => [
                  styles.sizeButton,
                  { borderColor: activeTheme.secondary + '40' },
                  pressed && styles.controlPressed,
                ]}
              >
                <Text style={[styles.sizeLarge, { color: activeTheme.foreground }]}>A</Text>
              </Pressable>
            </View>

            <View style={styles.themeRow}>
              {themeOptions.map(([name, theme]) => {
                const selected = name === preferences.theme;
                return (
                  <Pressable
                    accessibilityLabel={`${theme.label} theme`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={name}
                    onPress={() => onPreferencesChange({ ...preferences, theme: name })}
                    style={styles.themeOption}
                  >
                    <View
                      style={[
                        styles.themeSwatch,
                        {
                          backgroundColor: theme.background,
                          borderColor: selected ? '#6558D3' : '#D5D0DA',
                          borderWidth: selected ? 3 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.themeLetters, { color: theme.foreground }]}>Aa</Text>
                    </View>
                    <Text style={[styles.themeLabel, { color: activeTheme.secondary }]}>
                      {theme.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {onImproveParsing ? (
              <Pressable
                accessibilityHint="Reprocesses this book and changes it only if your position can be preserved"
                accessibilityLabel="Improve parsing"
                accessibilityRole="button"
                disabled={isImprovingParsing}
                onPress={onImproveParsing}
                style={({ pressed }) => [
                  styles.improveButton,
                  { borderColor: activeTheme.secondary + '40' },
                  pressed && styles.controlPressed,
                ]}
              >
                {isImprovingParsing ? <ActivityIndicator color={activeTheme.secondary} /> : (
                  <View>
                    <Text style={[styles.improveTitle, { color: activeTheme.foreground }]}>Improve parsing</Text>
                    <Text style={[styles.improveBody, { color: activeTheme.secondary }]}>Re-detect structure without losing your place</Text>
                  </View>
                )}
              </Pressable>
            ) : null}
          </View>
  );
}
