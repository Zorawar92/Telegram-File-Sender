import { useEffect } from 'react';
import { useIncomingShare } from 'expo-sharing';

export type SharedFile = {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
};

/**
 * Riceve i file condivisi verso questa app dal menu "Condividi" di Android.
 * `useIncomingShare` funziona solo su Android/iOS: il componente va montato
 * esclusivamente su piattaforme native.
 */
export function IncomingShareBridge({
  onFileShared,
}: {
  onFileShared: (file: SharedFile, multiple: boolean) => void;
}) {
  const { resolvedSharedPayloads, isResolving, clearSharedPayloads } = useIncomingShare();

  useEffect(() => {
    if (isResolving || resolvedSharedPayloads.length === 0) return;
    const shared = resolvedSharedPayloads.find(
      (payload) => 'contentUri' in payload && Boolean(payload.contentUri),
    );
    if (!shared || !('contentUri' in shared) || !shared.contentUri) return;

    let sharedName = shared.originalName || 'File condiviso';
    try {
      sharedName = decodeURIComponent(sharedName);
    } catch {
      // Se il nome arriva già decodificato lo teniamo così com'è.
    }

    onFileShared(
      {
        name: sharedName,
        uri: shared.contentUri,
        size: shared.contentSize ?? undefined,
        mimeType: shared.contentMimeType ?? shared.mimeType,
      },
      resolvedSharedPayloads.length > 1,
    );
    clearSharedPayloads();
  }, [clearSharedPayloads, isResolving, onFileShared, resolvedSharedPayloads]);

  return null;
}
