import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking, Modal } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { LibraryScreen } from './src/components/LibraryScreen';
import { ReaderScreen } from './src/components/ReaderScreen';
import { useLibraryController } from './src/hooks/useLibraryController';
import { fileNameFromURI, friendlyErrorMessage } from './src/lib/libraryServices';
import type { BookSource } from './src/lib/libraryController';
import type { BookSummary } from './src/types';

export default function App() {
  const { books, preferences, activeBook, isLoading, isImporting, openingBookID, updatingChapterIDs, controller } = useLibraryController(Alert.alert);
  const handledIncomingURLs = useRef(new Set<string>());
  const importBookSource = useCallback((source: BookSource, open = false) => controller.importBookSource(source, open), [controller, isImporting]);
  const { openBook, updateProgress, updatePreferences } = controller;
  const readerSession = controller.readerSession;
  const closeReader = (paragraph: number) => controller.closeReader(paragraph, readerSession);
  const importIncomingURL = useCallback(
    async (url: string) => {
      if (!url.toLowerCase().startsWith('file://')) return;
      if (handledIncomingURLs.current.has(url)) return;
      handledIncomingURLs.current.add(url);

      const imported = await importBookSource(
        {
          name: fileNameFromURI(url),
          uri: url,
        },
        true,
      );
      if (!imported) handledIncomingURLs.current.delete(url);
    },
    [importBookSource],
  );

  useEffect(() => {
    if (isLoading) return;

    let isMounted = true;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void importIncomingURL(url);
    });

    Linking.getInitialURL()
      .then((url) => {
        if (isMounted && url) void importIncomingURL(url);
      })
      .catch(() => {
        // An unavailable initial URL should not interrupt the normal library flow.
      });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [importIncomingURL, isLoading]);

  const importBook = useCallback(async () => {
    if (isImporting) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'application/epub+zip'],
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) throw new Error('No book was selected.');
      await importBookSource({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType });
    } catch (error) {
      Alert.alert('Couldn’t import book', friendlyErrorMessage(error));
    }
  }, [importBookSource, isImporting]);

  const confirmDeleteBook = useCallback(
    (book: BookSummary) => {
      Alert.alert(
        'Remove this book?',
        `“${book.title}” and your reading progress will be deleted from this device.`,
        [
          { style: 'cancel', text: 'Cancel' },
          {
            style: 'destructive',
            text: 'Remove',
            onPress: () => {
              void controller.removeBook(book).catch(error => Alert.alert('Couldn’t remove book', friendlyErrorMessage(error)));
            },
          },
        ],
      );
    },
    [controller],
  );

  return (
    <>
      <LibraryScreen
        books={books}
        isImporting={isImporting}
        isLoading={isLoading}
        onDeleteBook={confirmDeleteBook}
        onImport={importBook}
        onOpenBook={openBook}
        openingBookID={openingBookID}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => closeReader(activeBook?.summary.currentParagraph ?? 0)}
        presentationStyle="fullScreen"
        visible={activeBook !== null}
      >
        {activeBook ? (
          <ReaderScreen
            key={`${activeBook.summary.id}:${activeBook.content.layoutRevision ?? 'legacy'}`}
            book={activeBook.summary}
            content={activeBook.content}
            readingOffsets={activeBook.offsets}
            updatingChapters={updatingChapterIDs.includes(activeBook.summary.id)}
            onClose={closeReader}
            onPreferencesChange={updatePreferences}
            onProgressChange={(paragraph) => updateProgress(activeBook.summary.id, paragraph, readerSession)}
            preferences={preferences}
          />
        ) : null}
      </Modal>
    </>
  );
}
