import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { ApiError, isExactSavedMatch, type DiscogsAlbum } from '../services/api';
import { ModalDialog } from './ModalDialog';
import { SaveDestinationActions, type DestinationAction } from './SaveDestinationActions';
import { applyLookupPressingEdits, applyLookupShelfEdits, catalogSource, type LookupPressingEdits, type LookupShelfEdits } from '../albumDisplay';
import type { OpenSavedAlbum, SavePressing, UndoPressing } from './PressingComparison';
import { LookupRecovery } from './LookupRecovery';
import type { ManualAlbumDraft } from './ManualAlbumDialog';

interface ImageUploaderProps {
  onClose: () => void;
  onBack?: () => void;
  onSuccess: () => void;
  onSearchByName: (query?: string, draft?: ManualAlbumDraft) => void;
  onManual: (draft?: ManualAlbumDraft) => void;
  onMoveSaved: (id: number, title: string) => Promise<boolean>;
  onOpenSaved: OpenSavedAlbum;
  onSavePressing?: SavePressing;
  onUndoPressing?: UndoPressing;
  onSavedCopyRemoved?: (id: number) => void;
  lookupShelfEdits?: LookupShelfEdits;
  lookupPressingEdits?: LookupPressingEdits;
  viewMode: 'collection' | 'wishlist';
}

export const ImageUploader = ({ onClose, onBack, onSuccess, onSearchByName, onManual, onMoveSaved, onOpenSaved, onSavePressing,
  onUndoPressing, onSavedCopyRemoved, lookupShelfEdits, lookupPressingEdits, viewMode }: ImageUploaderProps) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [matches, setMatches] = useState<DiscogsAlbum[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [extractedInfo, setExtractedInfo] = useState<Awaited<ReturnType<typeof api.analyzeImage>>['extractedText'] | null>(null);
  const [saving, setSaving] = useState<{ id: number; action: DestinationAction }>();
  const [duplicates, setDuplicates] = useState<Record<number, number>>({});
  const saveInProgress = useRef(false);
  const [analysisError, setAnalysisError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const outcomeHeading = useRef<HTMLHeadingElement>(null);
  const focusUpload = useRef(false);
  const draft = extractedInfo ? { artist: extractedInfo.artist, album: extractedInfo.album } : undefined;
  const results = matches.map(match => applyLookupShelfEdits(applyLookupPressingEdits({
    ...match, existingStatus: match.inCollection ? 'collection' as const : match.inWishlist ? 'wishlist' as const : undefined,
  }, lookupPressingEdits), lookupShelfEdits));
  const allTitleOnly = results.every(match => match.existingStatus && !isExactSavedMatch(match.existingMatch));

  useLayoutEffect(() => {
    if (!analyzing && (analysisError || matches.length)) outcomeHeading.current?.focus();
    if (!imagePreview && focusUpload.current) {
      focusUpload.current = false;
      fileInput.current?.focus();
    }
  }, [analyzing, analysisError, matches, imagePreview]);
  const clearPhoto = () => {
    setImagePreview('');
    setMatches([]);
    setDuplicates({});
    setExtractedInfo(null);
    setAnalysisError('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    clearPhoto();

    // Validate file type
    const isHEIC = /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)$/i.test(file.type);
    if (!file.type.startsWith('image/') && !isHEIC) {
      setAnalysisError('Choose an image file, such as JPG, PNG, or HEIC.');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setAnalysisError('Choose an image under 10 MB.');
      return;
    }

    // Convert to base64
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setAnalyzing(false);
      setAnalysisError('Could not read this image. Choose it again or try another photo.');
    };
    reader.onload = async () => {
      const base64 = reader.result as string;

      // Check if this is a HEIC image (browsers can't display HEIC)
      // Only set preview for displayable formats
      if (!isHEIC) {
        setImagePreview(base64);
      } else {
        // Set a placeholder for HEIC images
        setImagePreview('HEIC');
      }

      try {
        const result = await api.analyzeImage(base64);

        setExtractedInfo(result.extractedText);

        if (result.discogsMatches.length === 0) {
          setAnalysisError('No catalog albums matched the detected text.');
        } else {
          setMatches(result.discogsMatches);
        }
      } catch {
        setAnalysisError('Could not identify this cover.');
      } finally {
        setAnalyzing(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const saveMatch = async (match: DiscogsAlbum, action: DestinationAction) => {
    if (match.inCollection || saveInProgress.current) return;
    const moveId = action === 'move' && match.inWishlist && isExactSavedMatch(match.existingMatch) ? match.existingAlbumId : undefined;
    const adding = action !== 'move' && !match.inWishlist;
    if (!moveId && !adding) return;

    saveInProgress.current = true;
    setSaving({ id: match.discogsId, action });
    try {
      if (moveId) {
        if (!await onMoveSaved(moveId, match.album)) return;
        onClose();
        return;
      } else if (adding) {
        await api.addAlbum({
          artist: match.artist,
          album: match.album,
          coverImageUrl: match.coverImageUrl,
          discogsId: match.discogsId,
          status: action,
        });
        toast.success(`Added “${match.album}” to ${action === 'collection' ? 'Collection' : 'Wishlist'}.`);
      }
      onSuccess();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.existingAlbumId !== undefined) {
        const savedId = error.existingAlbumId;
        setDuplicates(current => ({ ...current, [match.discogsId]: savedId }));
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not save the album. Try again.');
      }
    } finally {
      saveInProgress.current = false;
      setSaving(undefined);
    }
  };

  const close = () => {
    if (!saveInProgress.current) onClose();
  };

  return (
    <ModalDialog labelledBy="identify-cover-title" onClose={close}>
      <div className="rh-dialog-panel max-w-2xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 id="identify-cover-title" className="text-xl font-bold text-gray-900">Identify a cover</h2>
          </div>
          <button
            className="rh-dialog-close"
            aria-label="Close cover identification"
            onClick={close}
            disabled={!!saving}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {onBack && <button type="button" className="rh-lookup-link" disabled={!!saving}
            onClick={() => { if (!saveInProgress.current) onBack(); }}>Back to add methods</button>}
          <input ref={fileInput} id="cover-photo-file" type="file" accept="image/*,.heic,.heif"
            onChange={handleFileChange} disabled={analyzing || !!saving} className="sr-only"
            tabIndex={imagePreview ? -1 : undefined} aria-label="Choose a cover photo" />
          {!imagePreview && !analyzing && (
            <label htmlFor="cover-photo-file" className="rh-upload-label rh-cover-pick">
              <svg aria-hidden="true" className="size-7 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22a2 2 0 001.664.89H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="min-w-0">
                <span className="block text-base font-semibold">Choose a cover photo</span>
                <span className="mt-1 block text-sm text-gray-600">JPG, PNG or HEIC, up to 10 MB</span>
              </span>
            </label>
          )}

          {imagePreview && (
            <div className="rh-lookup-record">
              {imagePreview === 'HEIC' ? (
                <span className="grid size-16 shrink-0 place-items-center rounded-lg border border-gray-300 text-xs font-semibold">HEIC</span>
              ) : (
                <img src={imagePreview} alt="Uploaded cover" className="size-16 shrink-0 rounded-lg object-contain" />
              )}
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {draft && (draft.artist || draft.album) ? (
                  <p className="text-sm text-gray-600">Detected text · <strong className="text-gray-900">{[draft.artist, draft.album].filter(Boolean).join(' · ')}</strong></p>
                ) : <p className="text-sm font-medium">Cover photo</p>}
                {typeof extractedInfo?.confidence === 'number' && extractedInfo.confidence > 0 && (
                  <p className="mt-1 text-xs text-gray-600">Text recognition confidence: {Math.round(extractedInfo.confidence)}%</p>
                )}
                {!analyzing && <button type="button" className="rh-lookup-link" title="Remove image"
                  disabled={!!saving} onClick={() => {
                    focusUpload.current = true;
                    clearPhoto();
                  }}>Remove photo</button>}
              </div>
            </div>
          )}

          {analyzing && <p className="text-sm font-medium text-gray-600" role="status">Looking for matching albums…</p>}

          {analysisError && (
            <div className="space-y-2">
              <h3 ref={outcomeHeading} tabIndex={-1} className="font-semibold">Find this album another way</h3>
              <p className="text-sm text-red-600" role="alert">{analysisError}</p>
              <LookupRecovery direct draft={draft} onSearchByName={onSearchByName} onManual={onManual} />
            </div>
          )}

          {matches.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-x-2">
                <h3 ref={outcomeHeading} tabIndex={-1} className="py-2 text-lg font-semibold text-gray-900">
                  {matches.length === 1 ? '1 possible match' : `${matches.length} possible matches`}
                </h3>
                {!allTitleOnly && <LookupRecovery draft={draft} disabled={!!saving} onSearchByName={onSearchByName} onManual={onManual} />}
              </div>
              {saving && <p role="status" className="text-sm text-gray-600">Saving this album…</p>}
              <div className="space-y-3">
                {results.map(match => {
                  const { existingStatus } = match;
                  const duplicateId = duplicates[match.discogsId];
                  const foundDuplicate = duplicateId !== undefined && lookupShelfEdits?.[duplicateId] !== null;

                  return (
                    <article key={match.discogsId} className="rounded-xl border border-gray-300 p-3">
                      <div className="flex items-start gap-3">
                        {match.coverImageUrl && (
                          <img src={match.coverImageUrl} alt="" loading="lazy" className="size-14 rounded-lg object-cover" />
                        )}
                        <div className="min-w-0">
                          <h4 className="font-semibold text-gray-900 break-words">{match.album}</h4>
                          <p className="text-sm text-gray-600 break-words">
                            {match.artist}{match.year ? ` · ${match.year}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3">
                        {foundDuplicate ? (
                          <div className="grid gap-1">
                            <p role="alert" className="text-sm">This album is already saved.</p>
                          <button type="button" autoFocus className="rh-primary-action px-3 text-sm font-semibold" disabled={!!saving}
                              onClick={event => void onOpenSaved(duplicateId, event.currentTarget)}>Open saved album</button>
                          </div>
                        ) : <SaveDestinationActions
                          albumTitle={match.album}
                          preferred={viewMode}
                          existingStatus={existingStatus}
                          existingMatch={match.existingMatch}
                          existingAlbumId={match.existingAlbumId}
                          titleMatches={match.titleMatches}
                          lookup={{ artist: match.artist, year: match.year, source: catalogSource(match),
                            pressing: match.pressing, releaseId: catalogSource(match)?.kind === 'pressing' ? match.discogsId : undefined }}
                          onSearch={() => onSearchByName(`${match.artist} ${match.album}`, { artist: match.artist, album: match.album })}
                          searchLabel="Search catalogs by name"
                          onOpenSaved={onOpenSaved}
                          onSavePressing={catalogSource(match)?.kind === 'pressing' ? onSavePressing : undefined}
                          onUndoPressing={onUndoPressing}
                          onSavedCopyRemoved={onSavedCopyRemoved}
                          pending={saving?.id === match.discogsId ? saving.action : undefined}
                          disabled={!!saving}
                          onSelect={action => void saveMatch({
                            ...match, inCollection: existingStatus === 'collection', inWishlist: existingStatus === 'wishlist',
                          }, action)}
                        />}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {imagePreview && !analyzing && <button type="button" className="rh-lookup-link" disabled={!!saving}
              onClick={() => fileInput.current?.click()}>Choose another photo</button>}
            <button type="button" className="rh-lookup-link" onClick={close} disabled={!!saving}>Cancel</button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
