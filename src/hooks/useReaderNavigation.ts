import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { ReadingSession } from '../lib/readingPosition';
import type { BookContent, BookSummary } from '../types';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(callback, 16);
  return () => clearTimeout(timer);
}

export function useReaderNavigation(book: BookSummary, content: BookContent, onProgressChange: (index: number) => void) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pageHeight = viewport.height;
  const session = useRef(new ReadingSession(book.currentParagraph, content.paragraphs.length)).current;
  const initialParagraph = session.index;
  const [currentParagraph, setCurrentParagraph] = useState(initialParagraph);
  const [settledParagraph, setSettledParagraph] = useState<number | null>(null);
  const listRef = useRef<FlatList<string>>(null);
  const scroll = useRef({
    offset: null as number | null, height: 0, dragging: false, momentum: false,
    awaitingContent: true, target: initialParagraph as number | null,
  });
  const paragraphCount = useRef(content.paragraphs.length);
  paragraphCount.current = content.paragraphs.length;
  const pendingFrame = useRef<(() => void) | null>(null);
  const settlementVersion = useRef(0);
  const mounted = useRef(true);
  const cancelSettlement = useCallback(() => {
    settlementVersion.current += 1;
    pendingFrame.current?.();
    pendingFrame.current = null;
  }, []);
  const invalidateSettlement = useCallback(() => {
    cancelSettlement();
    setSettledParagraph(null);
  }, [cancelSettlement]);
  const scheduleSettlement = useCallback(() => {
    cancelSettlement();
    const state = scroll.current;
    if (state.awaitingContent || state.dragging || state.momentum || state.offset == null
      || !Number.isFinite(state.offset) || !Number.isFinite(state.height) || state.height <= 0) return;
    const offset = state.offset;
    const index = Math.round(offset / state.height);
    if (index < 0 || index >= paragraphCount.current
      || Math.abs(offset - index * state.height) > 1
      || (state.target != null && state.target !== index)) return;
    const version = settlementVersion.current;
    let stableFrames = 0;
    const check = () => {
      pendingFrame.current = null;
      const latest = scroll.current;
      if (!mounted.current || version !== settlementVersion.current
        || latest.dragging || latest.momentum || latest.awaitingContent
        || latest.offset == null || Math.abs(latest.offset - offset) > 0.1) return;
      stableFrames += 1;
      if (stableFrames < 2) pendingFrame.current = nextFrame(check);
      else {
        latest.target = null;
        setSettledParagraph(index);
      }
    };
    pendingFrame.current = nextFrame(check);
  }, [cancelSettlement]);
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
      invalidateSettlement();
      scroll.current = {
        offset: null, height, dragging: false, momentum: false,
        awaitingContent: true, target: session.index,
      };
      setViewport({ width, height });
    }
  };

  const commitScrollOffset = useCallback(
    (event: ScrollEvent) => {
      const offset = event.nativeEvent.contentOffset.y;
      if (offset !== scroll.current.offset) invalidateSettlement();
      scroll.current.offset = offset;
      const previous = session.index;
      const index = session.scroll(offset, pageHeight);
      if (index !== previous) commitPosition(index);
      scheduleSettlement();
    },
    [commitPosition, session, pageHeight, invalidateSettlement, scheduleSettlement],
  );

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    const state = scroll.current;
    if (!state.awaitingContent || height <= 0 || state.height <= 0) return;
    state.awaitingContent = false;
    // At initial offset zero and after list remounts, native may emit no scroll
    // event. The mounted content plus two stable frames confirms the requested
    // starting page provisionally; the gaze view also checks native geometry.
    if (!state.dragging && !state.momentum && state.target != null) {
      state.offset = state.target * state.height;
    }
    scheduleSettlement();
  }, [scheduleSettlement]);

  const onScrollBeginDrag = useCallback((event?: ScrollEvent) => {
    invalidateSettlement();
    session.beginDrag();
    const state = scroll.current;
    state.dragging = true;
    state.momentum = false;
    state.target = null;
    if (event) state.offset = event.nativeEvent.contentOffset.y;
  }, [invalidateSettlement, session]);

  const onScrollEndDrag = useCallback((event: ScrollEvent) => {
    commitScrollOffset(event);
    scroll.current.dragging = false;
    scheduleSettlement();
  }, [commitScrollOffset, scheduleSettlement]);

  const onMomentumScrollBegin = useCallback((event?: ScrollEvent) => {
    invalidateSettlement();
    scroll.current.dragging = false;
    scroll.current.momentum = true;
    if (event) scroll.current.offset = event.nativeEvent.contentOffset.y;
  }, [invalidateSettlement]);

  const onMomentumScrollEnd = useCallback((event: ScrollEvent) => {
    commitScrollOffset(event);
    scroll.current.dragging = false;
    scroll.current.momentum = false;
    scheduleSettlement();
  }, [commitScrollOffset, scheduleSettlement]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelSettlement();
    };
  }, [cancelSettlement]);

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
    invalidateSettlement();
    scroll.current.dragging = false;
    scroll.current.momentum = false;
    scroll.current.target = index;
    scroll.current.offset = index * scroll.current.height;
    listRef.current?.scrollToIndex({ animated: false, index });
    commitPosition(index);
    // Nonanimated same-page jumps need not produce a native scroll callback.
    scheduleSettlement();
  }, [session, commitPosition, invalidateSettlement, scheduleSettlement]);
  return { viewport, pageHeight, session, initialParagraph, currentParagraph, settledParagraph, listRef,
    onLayout, onContentSizeChange, commitScrollOffset, onScrollBeginDrag, onScrollEndDrag,
    onMomentumScrollBegin, onMomentumScrollEnd, getItemLayout, jumpToPosition };
}
