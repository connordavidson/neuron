import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Linking, Modal,
  Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import PDFTextExtractor from '../../modules/pdf-text-extractor/src/PDFTextExtractorModule';
import { PageScanSession, type PageScanState } from '../lib/pageScanSession';
import type { readerThemes } from '../theme';

type Props = {
  bookId: string;
  bookTitle: string;
  paragraphs: readonly string[];
  layoutRevision?: string;
  currentPosition: () => number;
  onJump: (position: number) => void;
  visible: boolean;
  hiddenByPanel: boolean;
  opacity: Animated.Value;
  disabled: boolean;
  theme: (typeof readerThemes)['paper'];
};

const initialState: PageScanState = { phase: 'closed', busy: false };

export function PageScanControl({
  bookId, bookTitle, paragraphs, layoutRevision, currentPosition, onJump,
  visible, hiddenByPanel, opacity, disabled, theme,
}: Props) {
  const [state, setState] = useState<PageScanState>(initialState);
  const sessionRef = useRef<PageScanSession | null>(null);
  const callbacks = useRef({ currentPosition, onJump });
  callbacks.current = { currentPosition, onJump };

  useEffect(() => {
    const session = new PageScanSession({
      paragraphs,
      currentPosition: () => callbacks.current.currentPosition(),
      jump: position => callbacks.current.onJump(position),
      scan: async () => {
        if (typeof PDFTextExtractor.scanBookPage !== 'function') {
          throw Object.assign(new Error('Rebuild the iOS app to enable page scanning.'), { code: 'ERR_SCAN_REBUILD' });
        }
        return PDFTextExtractor.scanBookPage();
      },
      onChange: setState,
    });
    sessionRef.current = session;
    setState(initialState);
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [bookId, paragraphs, layoutRevision]);

  useEffect(() => {
    if (state.undoPosition != null) AccessibilityInfo.announceForAccessibility('Found your place. Undo is available at the bottom of the reader.');
  }, [state.undoPosition]);

  const textColor = { color: theme.foreground };
  const secondaryColor = { color: theme.secondary };
  const locked = disabled || state.busy;
  const openSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert('Open Settings', 'Open the Settings app, find Neuron, and allow camera access.');
    });
  };

  return (
    <>
      <Animated.View
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.bottomControls, { opacity: hiddenByPanel ? 0 : opacity }]}
      >
        {state.undoPosition != null ? (
          <View style={[styles.undoBanner, { backgroundColor: theme.background, borderColor: theme.secondary + '50' }]}>
            <Text style={[styles.foundLabel, textColor]}>Found your place</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Undo scan jump" onPress={() => sessionRef.current?.undo()} style={styles.action}>
              <Text style={[styles.actionText, textColor]}>Undo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss scan result" onPress={() => sessionRef.current?.dismissUndo()} style={styles.dismiss}>
              <Text style={[styles.closeGlyph, secondaryColor]}>×</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan page"
            accessibilityHint="Find your place in this ebook by scanning a page in your physical book"
            accessibilityState={{ disabled: locked, busy: state.busy }}
            disabled={locked}
            onPress={() => sessionRef.current?.open()}
            style={[styles.scanButton, { backgroundColor: theme.background, borderColor: theme.secondary + '50' }, locked && styles.dimmed]}
          >
            {state.busy ? <ActivityIndicator color={theme.secondary} /> : null}
            <Text style={[styles.actionText, textColor]}>{state.busy ? 'Finishing scan…' : 'Scan page'}</Text>
          </Pressable>
        )}
      </Animated.View>

      <Modal
        animationType="fade"
        transparent
        visible={state.phase !== 'closed'}
        onRequestClose={() => sessionRef.current?.cancel()}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheetContainer}>
            <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.background }]}>
              <ScrollView bounces={false} contentContainerStyle={styles.sheetContent}>
                <Text accessibilityRole="header" style={[styles.title, textColor]}>
                  {state.phase === 'working' ? 'Finding your place…' : state.notice?.title ?? 'Scan a book page'}
                </Text>
                <Text style={[styles.bookTitle, secondaryColor]}>{bookTitle}</Text>
                {state.phase === 'working' ? (
                  <View style={styles.loading}>
                    <ActivityIndicator size="large" color={theme.foreground} />
                    <Text style={[styles.body, secondaryColor]}>Reading the scan and looking for matching text in your ebook.</Text>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.body, textColor]}>
                      {state.notice?.message ?? 'Scan one page in good light, include the top of the text, then tap Save.'}
                    </Text>
                    <Text style={[styles.privacy, secondaryColor]}>Processed on device.</Text>
                    {state.notice?.openSettings ? (
                      <Pressable accessibilityRole="button" onPress={openSettings} style={[styles.primaryButton, { backgroundColor: theme.foreground }]}>
                        <Text style={[styles.actionText, { color: theme.background }]}>Open Settings</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: state.busy }}
                      disabled={state.busy}
                      onPress={() => { void sessionRef.current?.start(); }}
                      style={[styles.primaryButton, { backgroundColor: theme.foreground }, state.busy && styles.dimmed]}
                    >
                      <Text style={[styles.actionText, { color: theme.background }]}>{state.phase === 'error' ? 'Scan again' : 'Open camera'}</Text>
                    </Pressable>
                  </>
                )}
                <Pressable accessibilityRole="button" onPress={() => sessionRef.current?.cancel()} style={styles.cancelButton}>
                  <Text style={[styles.actionText, secondaryColor]}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bottomControls: { position: 'absolute', bottom: 10, left: 24, right: 32, alignItems: 'center' },
  scanButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, borderWidth: 1, minHeight: 44, paddingHorizontal: 20, paddingVertical: 10 },
  actionText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  dimmed: { opacity: 0.5 },
  undoBanner: { borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, width: '100%', maxWidth: 480 },
  foundLabel: { fontSize: 13, flex: 1, paddingVertical: 10 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  dismiss: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 24 },
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheetContainer: { maxHeight: '85%' },
  sheet: { margin: 12, borderRadius: 24, overflow: 'hidden', flexShrink: 1 },
  sheetContent: { padding: 24 },
  title: { fontSize: 23, fontWeight: '700' },
  bookTitle: { fontSize: 14, marginTop: 8, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24, marginTop: 20 },
  privacy: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  loading: { paddingTop: 24, alignItems: 'center' },
  primaryButton: { marginTop: 20, borderRadius: 14, minHeight: 48, justifyContent: 'center', padding: 12 },
  cancelButton: { marginTop: 8, minHeight: 44, justifyContent: 'center', padding: 12 },
});
