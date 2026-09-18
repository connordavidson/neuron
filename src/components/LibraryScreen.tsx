import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../theme';
import { displayedProgress } from '../lib/readingPosition';
import { DELETE_REVEAL_WIDTH, isHorizontalSwipe, shouldRevealDelete, swipeOffset } from '../lib/swipeBook';
import type { BookSummary } from '../types';

type Props = {
  books: BookSummary[];
  isLoading: boolean;
  isImporting: boolean;
  openingBookID: string | null;
  onImport: () => void;
  onOpenBook: (book: BookSummary) => void;
  onDeleteBook: (book: BookSummary) => void;
};

export function LibraryScreen({
  books,
  isLoading,
  isImporting,
  openingBookID,
  onImport,
  onOpenBook,
  onDeleteBook,
}: Props) {
  const [query, setQuery] = useState('');
  const [swipedBookID, setSwipedBookID] = useState<string | null>(null);
  const filteredBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return books;
    return books.filter(
      (book) =>
        book.title.toLocaleLowerCase().includes(normalizedQuery) ||
        book.originalFileName.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [books, query]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <View style={styles.logo}>
              <Text style={styles.logoGlyph}>↕</Text>
            </View>
            <View>
              <Text style={styles.eyebrow}>YOUR READING FLOW</Text>
              <Text style={styles.title}>Neuron</Text>
            </View>
          </View>

          <Pressable
            accessibilityLabel="Import PDF"
            accessibilityRole="button"
            disabled={isImporting}
            onPress={onImport}
            style={styles.addButton}
          >
            <Text style={styles.addButtonGlyph}>＋</Text>
          </Pressable>
        </View>

        {books.length > 0 ? (
          <View style={styles.searchShell}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              accessibilityLabel="Search your library"
              autoCapitalize="none"
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Search your library"
              placeholderTextColor="#9A96A2"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        ) : books.length === 0 ? (
          <EmptyLibrary onImport={onImport} />
        ) : (
          <FlatList
            onScrollBeginDrag={() => setSwipedBookID(null)}
            contentContainerStyle={styles.listContent}
            data={filteredBooks}
            keyExtractor={(book) => book.id}
            ListEmptyComponent={
              <View style={styles.noResults}>
                <Text style={styles.noResultsTitle}>No books found that search</Text>
                <Text style={styles.noResultsBody}>Try a title or file name.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <BookCard
                book={item}
                isRevealed={swipedBookID === item.id}
                onReveal={(open) => setSwipedBookID(open ? item.id : null)}
                isOpening={openingBookID === item.id}
                onDelete={() => { setSwipedBookID(null); onDeleteBook(item); }}
                onOpen={() => onOpenBook(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {isImporting ? <ImportingOverlay /> : null}
    </SafeAreaView>
  );
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyArt}>
        <View style={[styles.emptyPage, styles.emptyPageBack]} />
        <View style={[styles.emptyPage, styles.emptyPageFront]}>
          <View style={styles.emptyLineWide} />
          <View style={styles.emptyLine} />
          <View style={styles.emptyLineShort} />
        </View>
      </View>

      <Text style={styles.emptyTitle}>One thought at a time</Text>
      <Text style={styles.emptyBody}>
        Import an ebook PDF, then swipe through it paragraph by paragraph.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onImport}
        style={styles.importButton}
      >
        <Text style={styles.importButtonIcon}>↓</Text>
        <Text style={styles.importButtonText}>Import a PDF</Text>
      </Pressable>
      <Text style={styles.privacyNote}>Your books stay on this device</Text>
    </View>
  );
}

function BookCard({
  book,
  isOpening,
  isRevealed,
  onReveal,
  onOpen,
  onDelete,
}: {
  book: BookSummary;
  isOpening: boolean;
  isRevealed: boolean;
  onReveal: (open: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const translation = useRef(new Animated.Value(0)).current;
  const gestureStart = useRef(0);
  const moved = useRef(false);
  const current = useRef({ isRevealed, onReveal, isOpening });
  current.current = { isRevealed, onReveal, isOpening };
  const settle = (open: boolean) => {
    Animated.spring(translation, { toValue: open ? -DELETE_REVEAL_WIDTH : 0,
      useNativeDriver: true, overshootClamping: true, speed: 24, bounciness: 0 }).start();
  };
  useEffect(() => { settle(isRevealed); }, [isRevealed, translation]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !current.current.isOpening && isHorizontalSwipe(gesture.dx, gesture.dy),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => !current.current.isOpening && isHorizontalSwipe(gesture.dx, gesture.dy),
    onPanResponderGrant: () => {
      moved.current = true;
      translation.stopAnimation();
      gestureStart.current = current.current.isRevealed ? -DELETE_REVEAL_WIDTH : 0;
    },
    onPanResponderMove: (_event, gesture) => translation.setValue(swipeOffset(gestureStart.current, gesture.dx)),
    onPanResponderRelease: (_event, gesture) => {
      const open = shouldRevealDelete(swipeOffset(gestureStart.current, gesture.dx), gesture.vx);
      current.current.onReveal(open);
      settle(open);
    },
    onPanResponderTerminate: () => { current.current.onReveal(false); settle(false); },
    onPanResponderTerminationRequest: () => true,
  }), [translation]);
  const readingStart = Math.max(0, Math.min(book.readingStart ?? 0, book.paragraphCount - 1));
  const readingPageCount = Math.max(1, book.paragraphCount - readingStart);
  const currentPage = Math.max(
    0,
    Math.min(book.currentParagraph - readingStart, readingPageCount - 1),
  );
  const { fraction: progress, label: progressLabel } = displayedProgress(book);

  return (
    <View style={styles.swipeShell}>
      <Pressable
        accessibilityLabel={`Delete ${book.title}`}
        accessibilityRole="button"
        accessibilityElementsHidden={!isRevealed}
        importantForAccessibility={isRevealed ? 'yes' : 'no-hide-descendants'}
        pointerEvents={isRevealed ? 'auto' : 'none'}
        onPress={onDelete}
        style={styles.deleteAction}
      >
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.trashIcon}>
          <View style={styles.trashHandle} />
          <View style={styles.trashLid} />
          <View style={styles.trashBody}>
            <View style={styles.trashLine} />
            <View style={styles.trashLine} />
          </View>
        </View>
      </Pressable>
      <Animated.View collapsable={false} {...panResponder.panHandlers} style={[styles.bookSwipeSurface, { transform: [{ translateX: translation }] }]}>
    <Pressable
      accessibilityHint="Opens the reader. Swipe left to reveal Delete."
      accessibilityLabel={`${book.title}, ${progressLabel}`}
      accessibilityRole="button"
      accessibilityActions={[{ name: 'delete', label: 'Delete book' }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'delete') onDelete(); }}
      disabled={isOpening}
      onPressIn={() => { moved.current = false; }}
      onPress={() => { if (moved.current) return; if (isRevealed) onReveal(false); else onOpen(); }}
      style={styles.bookCard}
    >
      <View style={styles.cover}>
        <View style={styles.coverCircleLarge} />
        <View style={styles.coverCircleSmall} />
        <Text style={styles.coverMark}>F</Text>
      </View>

      <View style={styles.bookDetails}>
        <Text numberOfLines={2} style={styles.bookTitle}>
          {book.title}
        </Text>
        <Text style={styles.bookMeta}>
          {book.currentSourcePage != null ? `PDF page ${book.currentSourcePage}` : `Reading page ${currentPage + 1}`}
        </Text>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{progressLabel}</Text>
        </View>
      </View>

      {isOpening ? <ActivityIndicator color={colors.brand} /> : null}
    </Pressable>
      </Animated.View>
    </View>
  );
}

function ImportingOverlay() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.overlay}>
      <View style={styles.importingCard}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.importingTitle}>Importing your book…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  screen: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 20 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 18,
    paddingTop: 12,
  },
  brandLockup: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  logo: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    shadowColor: colors.brandDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 9,
    width: 46,
  },
  logoGlyph: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', lineHeight: 30 },
  eyebrow: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    shadowColor: '#271C3A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    width: 46,
  },
  addButtonGlyph: { color: colors.brand, fontSize: 28, fontWeight: '400', lineHeight: 30 },
  searchShell: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 14,
  },
  searchIcon: { color: colors.muted, fontSize: 24, marginRight: 9, marginTop: -3 },
  searchInput: { color: colors.ink, flex: 1, fontSize: 16, height: 50 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 70,
    paddingHorizontal: 24,
  },
  emptyArt: { height: 152, marginBottom: 28, position: 'relative', width: 150 },
  emptyPage: {
    borderRadius: 18,
    height: 126,
    position: 'absolute',
    width: 92,
  },
  emptyPageBack: {
    backgroundColor: '#D8D3F8',
    left: 22,
    top: 16,
    transform: [{ rotate: '-12deg' }],
  },
  emptyPageFront: {
    backgroundColor: colors.surface,
    borderColor: '#DED9E7',
    borderWidth: 1,
    left: 43,
    paddingHorizontal: 16,
    paddingTop: 30,
    shadowColor: '#271C3A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.13,
    shadowRadius: 18,
    top: 7,
    transform: [{ rotate: '7deg' }],
  },
  emptyLineWide: { backgroundColor: colors.brand, borderRadius: 3, height: 5, marginBottom: 14 },
  emptyLine: { backgroundColor: '#D8D4DC', borderRadius: 3, height: 4, marginBottom: 9 },
  emptyLineShort: { backgroundColor: '#D8D4DC', borderRadius: 3, height: 4, width: '65%' },
  emptyTitle: { color: colors.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  emptyBody: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
    maxWidth: 330,
    textAlign: 'center',
  },
  importButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    marginTop: 26,
    paddingHorizontal: 28,
    paddingVertical: 16,
    shadowColor: colors.brandDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.23,
    shadowRadius: 12,
  },
  importButtonIcon: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  importButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  privacyNote: { color: '#92909A', fontSize: 12, marginTop: 14 },
  listContent: { gap: 12, paddingBottom: 32 },
  noResults: { alignItems: 'center', paddingTop: 80 },
  noResultsTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  noResultsBody: { color: colors.muted, fontSize: 14, marginTop: 5 },
  bookCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 126,
    padding: 14,
    shadowColor: '#271C3A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cover: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 13,
    height: 94,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 70,
  },
  coverCircleLarge: {
    backgroundColor: '#887CE4',
    borderRadius: 45,
    height: 90,
    position: 'absolute',
    right: -38,
    top: -30,
    width: 90,
  },
  coverCircleSmall: {
    backgroundColor: '#5145B8',
    borderRadius: 28,
    bottom: -24,
    height: 56,
    left: -16,
    position: 'absolute',
    width: 56,
  },
  coverMark: { color: '#FFFFFF', fontFamily: 'Georgia', fontSize: 35, fontWeight: '700' },
  bookDetails: { flex: 1, marginLeft: 15, marginRight: 8 },
  bookTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  bookMeta: { color: colors.muted, fontSize: 13, marginTop: 7 },
  progressRow: { alignItems: 'center', flexDirection: 'row', gap: 9, marginTop: 12 },
  progressTrack: {
    backgroundColor: '#EBE8EF',
    borderRadius: 3,
    flex: 1,
    height: 5,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: colors.brand, borderRadius: 3, height: '100%' },
  progressLabel: { color: colors.muted, fontSize: 11, minWidth: 59, textAlign: 'right' },
  swipeShell: { borderRadius: 20, overflow: 'hidden' },
  // Keep an opaque surface between the book and the swipe-revealed action.
  bookSwipeSurface: { backgroundColor: colors.surface, borderRadius: 20 },
  deleteAction: {
    alignItems: 'center',
    backgroundColor: '#C93434',
    borderRadius: 24,
    height: 48,
    position: 'absolute', top: '50%', right: (DELETE_REVEAL_WIDTH - 48) / 2,
    marginTop: -24,
    justifyContent: 'center',
    width: 48,
  },
  trashIcon: { width: 20, height: 22 },
  trashHandle: { position: 'absolute', top: 0, left: 6, width: 8, height: 5, borderColor: '#FFFFFF', borderWidth: 2, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  trashLid: { position: 'absolute', top: 4, width: 20, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },
  trashBody: { position: 'absolute', top: 7, left: 3, width: 14, height: 14, borderColor: '#FFFFFF', borderWidth: 2, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 2 },
  trashLine: { width: 1.5, backgroundColor: '#FFFFFF', borderRadius: 1 },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(19, 16, 28, 0.25)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  importingCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    minWidth: 270,
    paddingHorizontal: 28,
    paddingVertical: 26,
    shadowColor: '#17121F',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
  },
  importingTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginTop: 16 },
});
