import { useId, useLayoutEffect, useRef, useState } from 'react';
import { readManualAlbumDrafts, type StoredManualAlbumDraft } from '../services/manualAlbumDrafts';
import { ModalDialog } from './ModalDialog';

interface AddMenuProps {
  onBarcodeClick: () => void;
  onImageClick: () => void;
  onSearchClick: () => void;
  onCatalogNumberClick: () => void;
  onManualClick: () => void;
  onResumeManualClick?: (draft: StoredManualAlbumDraft) => void;
  onImportClick: () => void;
  onClose: () => void;
  discogsConfigured: boolean | null;
  discogsCheckFailed?: boolean;
  viewMode: 'collection' | 'wishlist';
}

function draftLabel(draft: StoredManualAlbumDraft) {
  const name = [draft.artist.trim(), draft.album.trim()].filter(Boolean).join(' · ') || draft.searchText?.trim();
  return [name, draft.shelf === 'collection' ? 'Collection' : 'Wishlist'].filter(Boolean).join(' · ');
}

export const AddMenu = ({
  onBarcodeClick, onImageClick, onSearchClick, onCatalogNumberClick, onManualClick, onResumeManualClick,
  onImportClick, onClose, discogsConfigured, discogsCheckFailed, viewMode,
}: AddMenuProps) => {
  const menuId = useId();
  const searchAction = useRef<HTMLButtonElement>(null);
  const [manualDrafts] = useState(readManualAlbumDrafts);
  const [manualDraft, ...otherDrafts] = manualDrafts;
  const clues = [
    {
      key: 'catalog-number',
      label: 'Look up a catalog number',
      description: 'Number on the sleeve or label',
      path: 'M4 7V5a1 1 0 0 1 1-1h5a2 2 0 0 1 1.4.6l8 8a2 2 0 0 1 0 2.8l-4 4a2 2 0 0 1-2.8 0l-8-8A2 2 0 0 1 4 10V7Zm4 1h.01',
      onClick: onCatalogNumberClick,
    },
    {
      key: 'barcode',
      label: 'Look up a barcode',
      description: 'Scan the barcode or type the digits below it',
      path: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
      onClick: onBarcodeClick,
    },
    {
      key: 'cover',
      label: 'Identify a cover',
      description: 'Use a photo of the artwork',
      path: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
      onClick: onImageClick,
    },
  ];

  useLayoutEffect(() => {
    searchAction.current?.focus({ preventScroll: true });
  }, []);

  return (
    <ModalDialog labelledBy={`${menuId}-title`} onClose={onClose}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-3">
          <h2 id={`${menuId}-title`} className="text-xl font-bold text-gray-900">Add an album</h2>
          <button type="button" onClick={onClose} className="rh-dialog-close" aria-label="Close add menu">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid gap-4 p-4 sm:gap-5 sm:p-6">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <button ref={searchAction} type="button" className="rh-primary-action flex min-w-0 items-center gap-3 px-3 py-3 text-left sm:px-4"
              aria-label="Search by name" aria-describedby={`${menuId}-search-description`} onClick={onSearchClick}>
              <svg className="size-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="min-w-0">
                <span className="block font-semibold">Search by name</span>
                <span id={`${menuId}-search-description`} className="block text-sm">Search your shelves and online catalogs</span>
              </span>
            </button>
            <button type="button" className="min-w-0 rounded-xl border border-gray-300 px-3 py-3 text-left hover:bg-gray-100 sm:px-4"
              aria-label="Add album manually" aria-describedby={`${menuId}-manual-description`} onClick={onManualClick}>
              <span className="block font-semibold text-gray-900">Add album manually</span>
              <span id={`${menuId}-manual-description`} className="block text-sm text-gray-600">Save the album now and identify the pressing later.</span>
            </button>
          </div>

          {manualDraft && onResumeManualClick && (
            <div className="flex min-w-0 flex-wrap items-start gap-1">
              <button type="button" className="rh-lookup-link min-w-0 max-w-full text-left" aria-label="Resume manual entry"
                aria-describedby={`${menuId}-draft-description`} onClick={() => onResumeManualClick(manualDraft)}>
                <span className="block">Resume manual entry</span>
                <span id={`${menuId}-draft-description`} className="block truncate text-xs font-normal text-gray-600">
                  {draftLabel(manualDraft)}
                </span>
              </button>
              {otherDrafts.length > 0 && (
                <details className="rh-lookup-recovery min-w-0 max-w-full">
                  <summary>Other manual drafts</summary>
                  <div className="grid pb-2">
                    {otherDrafts.map(entry => <button key={entry.id} type="button" className="rh-lookup-link min-w-0 text-left [overflow-wrap:anywhere]"
                      onClick={() => onResumeManualClick(entry)}>{draftLabel(entry)}</button>)}
                  </div>
                </details>
              )}
            </div>
          )}

          <section aria-labelledby={`${menuId}-clues`} className="border-t border-gray-200 pt-3">
            <h3 id={`${menuId}-clues`} className="mb-1 text-sm font-semibold text-gray-900">Have a clue on the record?</h3>
            <ul className="grid divide-y divide-gray-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {clues.map(({ key, label, description, path, onClick }) => (
                <li key={key} className="min-w-0">
                  <button type="button" className="rh-lookup-link flex h-full w-full items-start gap-2 py-2 text-left"
                    aria-label={label} aria-describedby={`${menuId}-${key}-description`} onClick={onClick}>
                    <svg className="mt-0.5 size-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
                    </svg>
                    <span className="min-w-0">
                      <span className="block text-gray-900">{label}</span>
                      <span id={`${menuId}-${key}-description`} className="block text-xs font-normal text-gray-600">{description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="border-t border-gray-200 px-4 py-1 sm:px-6">
          {discogsConfigured ? (
            <button type="button" className="min-h-11 rounded-lg px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              aria-description={`Default destination is ${viewMode === 'wishlist' ? 'Wishlist' : 'Collection'}. You can change it before importing.`}
              onClick={onImportClick}>Import from Discogs</button>
          ) : (
            <details className="min-w-0">
              <summary className="min-h-11 cursor-pointer content-center rounded-lg px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                Import from Discogs
              </summary>
              <div className="px-2 pb-2">
                {discogsCheckFailed ? (
                  <p className="text-sm text-gray-600" role="status">Could not check the Discogs connection. You can still add records by name.</p>
                ) : discogsConfigured === null ? (
                  <p className="text-sm text-gray-600" role="status">Checking the Discogs connection…</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">Ask your server administrator to connect Discogs before importing.</p>
                    <a href="https://github.com/mkurdziel/side-a-vinyl-collector#configuration" target="_blank" rel="noreferrer"
                      className="rh-comparison-source">Discogs setup instructions</a>
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
