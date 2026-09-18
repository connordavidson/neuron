import { File, Paths } from 'expo-file-system';

export function resolveBookPDF(id: string, fallback: string): string {
  const local = new File(Paths.document, 'Neuron', 'Books', `${id}.pdf`);
  return local.exists ? local.uri : fallback;
}
