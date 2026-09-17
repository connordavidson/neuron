import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { readerThemes } from '../theme';
import { ReadingSession, chapterProgressMarkers, readingProgressAtPosition } from '../lib/readingPosition';
import { currentChapterAt } from '../lib/bookStructure';
import { ReaderProgress } from './ReaderProgress';
import { PageScanControl } from './PageScanControl';
import type { BookContent, BookSummary, ReaderPreferences, ReaderThemeName } from '../types';

type Props = {
  book: BookSummary;
  content: BookContent;
  readingOffsets: number[];
  updatingChapters?: boolean;
  isImprovingParsing?: boolean;
  preferences: ReaderPreferences;
  onClose: (paragraph: number) => void;
  onImproveParsing?: () => void;
  onPreferencesChange: (preferences: ReaderPreferences) => void;
  onProgressChange: (paragraph: number) => void;
};

export function ReaderScreen({
  book,
  content,
  readingOffsets,
  updatingChapters = false,
  isImprovingParsing = false,
  preferences,
  onClose,
  onImproveParsing,
  onPreferencesChange,
  onProgressChange,
}: Props) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pageHeight = viewport.height;
  const session = useRef(new ReadingSession(book.currentParagraph, content.paragraphs.length)).current;
  const initialParagraph = session.index;
  const [currentParagraph, setCurrentParagraph] = useState(initialParagraph);
  const [showSettings, setShowSettings] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<string>>(null);
  const progressCallback = useRef(onProgressChange);
  progressCallback.current = onProgressChange;
  const activeTheme = readerThemes[preferences.theme];

  const commitPosition = useCallback(
    (index: number) => {
      setCurrentParagraph(index);
      progressCallback.current(index);
    },
    [],
  );

  const setChrome = useCallback(
    (visible: boolean) => {
      setChromeVisible(visible);
      Animated.timing(chromeOpacity, {
        duration: 170,
        toValue: visible ? 1 : 0,
        useNativeDriver: true,
      }).start();
    },
    [chromeOpacity],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== viewport.width || height !== viewport.height) {
      session.layoutChanged();
      setViewport({ width, height });
    }
  };

  const commitScrollOffset = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const previous = session.index;
      const index = session.scroll(event.nativeEvent.contentOffset.y, pageHeight);
      if (index !== previous) commitPosition(index);
    },
    [commitPosition, session, pageHeight],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') progressCallback.current(session.index);
    });
    return () => subscription.remove();
  }, [session]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<string> | null | undefined, index: number) => ({
      index,
      length: pageHeight,
      offset: pageHeight * index,
    }),
    [pageHeight],
  );

  const goToParagraph = useCallback(
    (paragraphIndex: number) => {
      const index = session.jump(paragraphIndex);
      listRef.current?.scrollToIndex({ animated: false, index });
      commitPosition(index);
      setShowChapters(false);
      setChrome(true);
    },
    [commitPosition, session, setChrome],
  );

  const themeOptions = useMemo(
    () => Object.entries(readerThemes) as [ReaderThemeName, (typeof readerThemes)[ReaderThemeName]][],
    [],
  );
  const currentChapter = useMemo(() => currentChapterAt(content.chapters, currentParagraph), [content.chapters, currentParagraph]);
  const progressMarkers = useMemo(() => chapterProgressMarkers(content, readingOffsets), [content, readingOffsets]);
  const readingProgress = readingProgressAtPosition(content, readingOffsets, currentParagraph);
  const progressPercent = readingProgress >= 1 ? 100 : Math.min(99, Math.round(readingProgress * 100));
  const currentUnit = content.readingUnits?.[currentParagraph];
  const currentSupplements = useMemo(() => {
    const ids = new Set(currentUnit?.supplementIds ?? []);
    return content.supplements?.filter(({ id }) => ids.has(id)) ?? [];
  }, [content.supplements, currentUnit]);
  const navigationStart = content.readingStart;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.background }]}>
      <StatusBar style={preferences.theme === 'night' ? 'light' : 'dark'} />
      <View onLayout={onLayout} style={styles.reader}>
        {pageHeight > 0 ? (
          <FlatList
            key={`${viewport.width}:${viewport.height}`}
            ref={listRef}
            style={styles.list}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            data={content.paragraphs}
            decelerationRate="fast"
            getItemLayout={getItemLayout}
            initialNumToRender={2}
            initialScrollIndex={initialParagraph}
            keyExtractor={(_item, index) => `${book.id}-${index}`}
            maxToRenderPerBatch={3}
            onMomentumScrollEnd={commitScrollOffset}
            onScroll={commitScrollOffset}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => session.beginDrag()}
            onScrollEndDrag={commitScrollOffset}
            onScrollToIndexFailed={() => {
              requestAnimationFrame(() => {
                listRef.current?.scrollToOffset({ animated: false, offset: session.index * pageHeight });
              });
            }}
            pagingEnabled
            snapToInterval={pageHeight}
            snapToAlignment="start"
            removeClippedSubviews={false}
            renderItem={({ item }) => (
              <ParagraphPage
                fontSize={preferences.fontSize}
                height={pageHeight}
                onPress={() => setChrome(!chromeVisible)}
                text={item}
                theme={activeTheme}
              />
            )}
            showsVerticalScrollIndicator={false}
            windowSize={5}
          />
        ) : null}

        <Animated.View
          accessibilityElementsHidden={!chromeVisible || showSettings || showChapters || showContext}
          importantForAccessibility={!chromeVisible || showSettings || showChapters || showContext ? 'no-hide-descendants' : 'auto'}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: chromeOpacity }]}
        >
          <ReaderProgress
            fraction={readingProgress}
            markers={progressMarkers}
            label={`${progressPercent}% read${currentChapter ? `, ${currentChapter.title}` : ''}`}
            viewportHeight={pageHeight}
            theme={activeTheme}
          />
        </Animated.View>

        <Animated.View
          pointerEvents={chromeVisible ? 'auto' : 'none'}
          style={[styles.topChrome, { opacity: chromeOpacity }]}
        >
          <Pressable
            accessibilityLabel="Back to library"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onClose(session.index)}
            style={[
              styles.roundControl,
              { backgroundColor: activeTheme.foreground + '12' },
            ]}
          >
            <Text style={[styles.backGlyph, { color: activeTheme.foreground }]}>‹</Text>
          </Pressable>

          <View style={styles.chromeTitleBlock}>
            <Text numberOfLines={1} style={[styles.chromeTitle, { color: activeTheme.foreground }]}>
              {book.title}
            </Text>
            {currentChapter ? (
              <Text numberOfLines={2} accessibilityLabel={currentChapter.title} style={[styles.chromeChapter, { color: activeTheme.secondary }]}>
                {currentChapter.title}
              </Text>
            ) : null}
          </View>

          <View style={styles.chromeActions}>
            {currentSupplements.length ? (
              <Pressable
                accessibilityLabel={`Open ${currentSupplements.length} contextual notes`}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setShowContext((current) => !current);
                  setShowChapters(false);
                  setShowSettings(false);
                  setChrome(true);
                }}
                style={[
                  styles.roundControl,
                  { backgroundColor: activeTheme.foreground + '12' },
                ]}
              >
                <Text style={[styles.contextGlyph, { color: activeTheme.foreground }]}>†</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Open chapters"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setShowChapters((current) => !current);
                setShowSettings(false);
                setShowContext(false);
                setChrome(true);
              }}
              style={[
                styles.roundControl,
                { backgroundColor: activeTheme.foreground + '12' },
              ]}
            >
              <Text style={[styles.chaptersGlyph, { color: activeTheme.foreground }]}>☰</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Reading settings"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setShowSettings((current) => !current);
                setShowChapters(false);
                setShowContext(false);
                setChrome(true);
              }}
              style={[
                styles.roundControl,
                { backgroundColor: activeTheme.foreground + '12' },
              ]}
            >
              <Text style={[styles.settingsGlyph, { color: activeTheme.foreground }]}>Aa</Text>
            </Pressable>
          </View>
        </Animated.View>

        <PageScanControl
          bookId={book.id}
          bookTitle={book.title}
          paragraphs={content.paragraphs}
          layoutRevision={content.layoutRevision}
          currentPosition={() => session.index}
          onJump={goToParagraph}
          visible={chromeVisible && !showSettings && !showChapters && !showContext}
          hiddenByPanel={showSettings || showChapters || showContext}
          opacity={chromeOpacity}
          disabled={isImprovingParsing || pageHeight <= 0}
          theme={activeTheme}
        />

        {showChapters ? (
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
              <Pressable accessibilityLabel="Close chapters" onPress={() => setShowChapters(false)}>
                <Text style={[styles.doneButton, { color: activeTheme.secondary }]}>Done</Text>
              </Pressable>
            </View>
            {navigationStart > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => goToParagraph(navigationStart)}
                style={styles.startReadingRow}
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
                    style={[styles.chapterRow, { marginLeft: Math.min(28, (chapter.level ?? 0) * 10) },
                      chapter === currentChapter && { backgroundColor: activeTheme.foreground + '0D' }]}
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
        ) : null}

        {showContext ? (
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
              <Pressable accessibilityLabel="Close notes" onPress={() => setShowContext(false)}>
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
        ) : null}

        {showSettings ? (
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
                onPress={() => setShowSettings(false)}
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
                style={[
                  styles.sizeButton,
                  { borderColor: activeTheme.secondary + '40' },
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
                style={[
                  styles.sizeButton,
                  { borderColor: activeTheme.secondary + '40' },
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
                style={[
                  styles.improveButton,
                  { borderColor: activeTheme.secondary + '40' },
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
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ParagraphPage({
  text,
  height,
  fontSize,
  theme,
  onPress,
}: {
  text: string;
  height: number;
  fontSize: number;
  theme: (typeof readerThemes)[ReaderThemeName];
  onPress: () => void;
}) {
  const [textViewportHeight, setTextViewportHeight] = useState(0);
  const [textContentHeight, setTextContentHeight] = useState(0);
  return (
    <View style={[styles.page, { height }]}>
      <ScrollView
        style={styles.textContainer}
        contentContainerStyle={styles.textScrollContent}
        onLayout={(event) => setTextViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, contentHeight) => setTextContentHeight(contentHeight)}
        scrollEnabled={textViewportHeight > 0 && textContentHeight > textViewportHeight + 1}
        nestedScrollEnabled
        bounces={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityHint="Swipe up or down for another reading page. Tap to hide or show controls."
          accessibilityLabel={text}
          onPress={onPress}
          style={styles.textPressable}
        >
        <Text
          selectable
          style={[
            styles.paragraph,
            {
              color: theme.foreground,
              fontSize,
              lineHeight: Math.round(fontSize * 1.52),
            },
          ]}
        >
          {text}
        </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  reader: { flex: 1 },
  list: { flex: 1 },
  page: { flexShrink: 0, width: '100%', overflow: 'hidden', paddingBottom: 76, paddingHorizontal: 30, paddingTop: 70 },
  textContainer: { flex: 1, width: '100%' },
  textScrollContent: { flexGrow: 1 },
  textPressable: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 12 },
  paragraph: {
    fontFamily: 'Georgia',
    letterSpacing: 0.1,
    maxWidth: 700,
    width: '100%',
  },
  topChrome: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 10,
  },
  chromeActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  roundControl: {
    alignItems: 'center',
    borderRadius: 19,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  backGlyph: { fontSize: 36, fontWeight: '300', lineHeight: 37, marginTop: -3 },
  settingsGlyph: { fontFamily: 'Georgia', fontSize: 15, fontWeight: '700' },
  chaptersGlyph: { fontSize: 18, fontWeight: '700' },
  contextGlyph: { fontFamily: 'Georgia', fontSize: 21, fontWeight: '700' },
  chromeTitleBlock: { flex: 1, marginHorizontal: 12 },
  chromeTitle: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  chromeChapter: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  chapterMeta: { fontSize: 12, marginTop: 4, marginBottom: 4 },
  settingsPanel: {
    borderRadius: 24,
    borderWidth: 1,
    bottom: 16,
    left: 16,
    padding: 20,
    position: 'absolute',
    right: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  chapterPanel: {
    borderRadius: 24,
    borderWidth: 1,
    bottom: 16,
    left: 16,
    maxHeight: '72%',
    padding: 20,
    position: 'absolute',
    right: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  contextPanel: {
    borderRadius: 24,
    borderWidth: 1,
    bottom: 16,
    left: 16,
    maxHeight: '66%',
    padding: 20,
    position: 'absolute',
    right: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  chapterList: { marginTop: 12 },
  chapterRow: { borderBottomColor: '#E5E1E9', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  chapterTitle: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  noChapters: { fontSize: 15, paddingVertical: 18 },
  startReadingRow: { borderBottomColor: '#E5E1E9', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  startReadingTitle: { fontSize: 16, fontWeight: '700' },
  startReadingBody: { fontSize: 12, marginTop: 3 },
  settingsHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  settingsTitle: { fontSize: 17, fontWeight: '700' },
  doneButton: { fontSize: 14, fontWeight: '600' },
  sizeRow: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 18 },
  sizeButton: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  sizeSmall: { fontFamily: 'Georgia', fontSize: 16 },
  sizeLarge: { fontFamily: 'Georgia', fontSize: 24 },
  sizeValue: { fontSize: 12, fontVariant: ['tabular-nums'], width: 24, textAlign: 'center' },
  themeRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  themeOption: { alignItems: 'center', flex: 1, gap: 6 },
  themeSwatch: {
    alignItems: 'center',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    width: '100%',
  },
  themeLetters: { fontFamily: 'Georgia', fontSize: 18, fontWeight: '700' },
  themeLabel: { fontSize: 11, fontWeight: '600' },
  supplementRow: { borderBottomColor: '#E5E1E9', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13 },
  supplementKind: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  supplementText: { fontFamily: 'Georgia', fontSize: 15, lineHeight: 22, marginTop: 5 },
  improveButton: { borderRadius: 13, borderWidth: 1, justifyContent: 'center', marginTop: 18, minHeight: 58, paddingHorizontal: 14 },
  improveTitle: { fontSize: 14, fontWeight: '700' },
  improveBody: { fontSize: 11, marginTop: 3 },
});
