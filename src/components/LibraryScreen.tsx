import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
              <Text style={styles.title}>FlowReader</Text>
            </View>
          </View>

          <Pressable
            accessibilityLabel="Import PDF"
            accessibilityRole="button"
            disabled={isImporting}
            onPress={onImport}
            style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
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
                isOpening={openingBookID === item.id}
                onDelete={() => onDeleteBook(item)}
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
        style={({ pressed }) => [styles.importButton, pressed && styles.buttonPressed]}
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
  onOpen,
  onDelete,
}: {
  book: BookSummary;
  isOpening: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const readingStart = Math.max(0, Math.min(book.readingStart ?? 0, book.paragraphCount - 1));
  const readingPageCount = Math.max(1, book.paragraphCount - readingStart);
  const currentPage = Math.max(
    0,
    Math.min(book.currentParagraph - readingStart, readingPageCount - 1),
  );
  const { fraction: progress, label: progressLabel } = displayedProgress(book);

  return (
    <Pressable
      accessibilityHint="Opens the paragraph reader"
      accessibilityLabel={`${book.title}, ${progressLabel}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.bookCard, pressed && styles.cardPressed]}
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

      {isOpening ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <Pressable
          accessibilityLabel={`Delete ${book.title}`}
          accessibilityRole="button"
          hitSlop={10}
          onPress={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          style={({ pressed }) => [styles.moreButton, pressed && styles.moreButtonPressed]}
        >
          <Text style={styles.moreGlyph}>•••</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function ImportingOverlay() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.overlay}>
      <View style={styles.importingCard}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.importingTitle}>Preparing your book…</Text>
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
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
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
  cardPressed: { backgroundColor: '#FBFAFC', transform: [{ scale: 0.995 }] },
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
  moreButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    width: 34,
  },
  moreButtonPressed: { backgroundColor: colors.brandSoft },
  moreGlyph: { color: colors.muted, fontSize: 14, letterSpacing: 1, transform: [{ rotate: '90deg' }] },
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
