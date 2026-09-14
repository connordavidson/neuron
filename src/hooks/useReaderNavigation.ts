import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { ReadingSession } from '../lib/readingPosition';
import type { BookContent, BookSummary } from '../types';

export function useReaderNavigation(book: BookSummary, content: BookContent, onProgressChange: (index: number) => void) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pageHeight = viewport.height;
  const session = useRef(new ReadingSession(book.currentParagraph, content.paragraphs.length)).current;
  const initialParagraph = session.index;
  const [currentParagraph, setCurrentParagraph] = useState(initialParagraph);
  const listRef = useRef<FlatList<string>>(null);
  const progressCallback = useRef(onProgressChange);
  progressCallback.current = onProgressChange;
  const commitPosition = useCallback(
    (index: number) => {
      setCurrentParagraph(index);
      progressCallback.current(index);
    },
    [],
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

  const jumpToPosition = useCallback((position: number) => {
    const index = session.jump(position);
    listRef.current?.scrollToIndex({ animated: false, index });
    commitPosition(index);
  }, [session, commitPosition]);
  return { viewport, pageHeight, session, initialParagraph, currentParagraph, listRef,
    onLayout, commitScrollOffset, getItemLayout, jumpToPosition };
}
