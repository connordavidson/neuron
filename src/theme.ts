import type { ReaderThemeName } from './types';

export const colors = {
  ink: '#16151A',
  muted: '#6D6A75',
  surface: '#FFFFFF',
  canvas: '#F5F3F8',
  border: '#E8E4ED',
  brand: '#6558D3',
  brandDark: '#4D42B7',
  brandSoft: '#ECE9FF',
  danger: '#C84152',
};

export const readerThemes: Record<
  ReaderThemeName,
  { label: string; background: string; foreground: string; secondary: string }
> = {
  paper: {
    label: 'Paper',
    background: '#F8F6F0',
    foreground: '#1F1D19',
    secondary: '#777169',
  },
  sepia: {
    label: 'Sepia',
    background: '#EEDDBA',
    foreground: '#342A1F',
    secondary: '#74634D',
  },
  night: {
    label: 'Night',
    background: '#101116',
    foreground: '#E7E8ED',
    secondary: '#8D909C',
  },
};
