import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { useReaderNavigation } from '../hooks/useReaderNavigation';
import { ChaptersPanel, ContextPanel, SettingsPanel } from './ReaderPanels';
import { styles } from './readerStyles';
import { readerThemes } from '../theme';
import { chapterProgressMarkers, readingProgressAtPosition } from '../lib/readingPosition';
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
  const { viewport, pageHeight, session, initialParagraph, currentParagraph, listRef,
    onLayout, commitScrollOffset, getItemLayout, jumpToPosition } = useReaderNavigation(book, content, onProgressChange);
  const [panel, setPanel] = useState<'settings' | 'chapters' | 'context' | null>(null);
  const showSettings = panel === 'settings';
  const showChapters = panel === 'chapters';
  const showContext = panel === 'context';
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const activeTheme = readerThemes[preferences.theme];

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

  const goToParagraph = useCallback(
    (paragraphIndex: number) => {
      jumpToPosition(paragraphIndex);
      setPanel(null);
      setChrome(true);
    },
    [jumpToPosition, setChrome],
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
            style={({ pressed }) => [
              styles.roundControl,
              { backgroundColor: activeTheme.foreground + '12' },
              pressed && styles.controlPressed,
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
                  setPanel(current => current === 'context' ? null : 'context');
                  setChrome(true);
                }}
                style={({ pressed }) => [
                  styles.roundControl,
                  { backgroundColor: activeTheme.foreground + '12' },
                  pressed && styles.controlPressed,
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
                setPanel(current => current === 'chapters' ? null : 'chapters');
                  setChrome(true);
              }}
              style={({ pressed }) => [
                styles.roundControl,
                { backgroundColor: activeTheme.foreground + '12' },
                pressed && styles.controlPressed,
              ]}
            >
              <Text style={[styles.chaptersGlyph, { color: activeTheme.foreground }]}>☰</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Reading settings"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setPanel(current => current === 'settings' ? null : 'settings');
                  setChrome(true);
              }}
              style={({ pressed }) => [
                styles.roundControl,
                { backgroundColor: activeTheme.foreground + '12' },
                pressed && styles.controlPressed,
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

        {showChapters ? <ChaptersPanel activeTheme={activeTheme} preferences={preferences} navigationStart={navigationStart} goToParagraph={goToParagraph} onClose={() => setPanel(null)} updatingChapters={updatingChapters} content={content} currentChapter={currentChapter} /> : null}

        {showContext ? <ContextPanel activeTheme={activeTheme} preferences={preferences} onClose={() => setPanel(null)} currentSupplements={currentSupplements} /> : null}

        {showSettings ? <SettingsPanel activeTheme={activeTheme} preferences={preferences} onClose={() => setPanel(null)} onPreferencesChange={onPreferencesChange} themeOptions={themeOptions} onImproveParsing={onImproveParsing} isImprovingParsing={isImprovingParsing} /> : null}


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

