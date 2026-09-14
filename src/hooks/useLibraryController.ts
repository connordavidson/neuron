import { useEffect, useState } from 'react';
import { LibraryController } from '../lib/libraryController';
import { libraryServices, type LibraryServices } from '../lib/libraryServices';
export function useLibraryController(notify: LibraryServices['notify']) {
  const [controller] = useState(() => new LibraryController({ ...libraryServices, notify }));
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => controller.initialize(), [controller]);
  return { ...state, controller };
}
