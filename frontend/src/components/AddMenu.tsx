import { useId, useState } from 'react';
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

export const AddMenu = ({
  onBarcodeClick, onImageClick, onSearchClick, onCatalogNumberClick, onManualClick, onResumeManualClick, onImportClick, onClose, discogsConfigured, discogsCheckFailed, viewMode,
}: AddMenuProps) => {
  const draftDescriptionId = useId();
  const [manualDrafts] = useState(readManualAlbumDrafts);
  const [manualDraft, ...otherDrafts] = manualDrafts;
  const draftLabel = (draft: StoredManualAlbumDraft) => {
    const name = [draft.artist.trim(), draft.album.trim()].filter(Boolean).join(' · ') || draft.searchText?.trim();
    return [name, draft.shelf === 'collection' ? 'Collection' : 'Wishlist'].filter(Boolean).join(' · ');
  };

  return (
    <ModalDialog labelledBy="add-album-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between border-b border-gray-200 p-4 sm:p-6">
          <h2 id="add-album-title" className="text-xl font-bold text-gray-900">Add an album</h2>
          <button
            onClick={onClose}
            className="rh-dialog-close"
            aria-label="Close add menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 sm:p-6">
          <p className="col-span-full text-sm text-gray-600">
            Save the album now if you know the title, or confirm the exact pressing when you can check your copy.
          </p>
          <button
            className="rh-add-method group"
            onClick={onSearchClick}
          >
            <span className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-gray-900 mb-1">Search by name</span>
              <span className="block text-sm text-gray-600">Find an artist or album. Choose your shelves or online catalogs.</span>
            </span>
          </button>

          <button type="button" className="rh-add-method group" onClick={onCatalogNumberClick}>
            <span className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7V5a1 1 0 0 1 1-1h5a2 2 0 0 1 1.4.6l8 8a2 2 0 0 1 0 2.8l-4 4a2 2 0 0 1-2.8 0l-8-8A2 2 0 0 1 4 10V7Zm4 1h.01" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-gray-900 mb-1">Look up a catalog number</span>
              <span className="block text-sm text-gray-600">Use the number on the sleeve or record label.</span>
            </span>
          </button>

          <button
            className="rh-add-method group"
            onClick={onBarcodeClick}
          >
            <span className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-gray-900 mb-1">Look up a barcode</span>
              <span className="block text-sm text-gray-600">Scan the barcode or type the digits below it.</span>
            </span>
          </button>

          <button
            className="rh-add-method group"
            onClick={onImageClick}
          >
            <span className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-gray-900 mb-1">Identify a cover</span>
              <span className="block text-sm text-gray-600">Use a photo to find matching albums.</span>
            </span>
          </button>

        </div>
        <div className="flex flex-wrap items-start gap-2 border-t border-gray-200 px-4 py-2 sm:px-6">
          {manualDraft && onResumeManualClick && (
            <button type="button" className="rh-lookup-link min-w-0 max-w-full text-left" aria-label="Resume manual entry"
              aria-describedby={draftDescriptionId} onClick={() => onResumeManualClick(manualDraft)}>
              <span className="block">Resume manual entry</span>
              <span id={draftDescriptionId} className="block truncate text-xs font-normal text-gray-600">
                {draftLabel(manualDraft)}
              </span>
            </button>
          )}
          {otherDrafts.length > 0 && onResumeManualClick && (
            <details className="rh-lookup-recovery min-w-0 max-w-full">
              <summary>Other manual drafts</summary>
              <div className="grid pb-2">
                {otherDrafts.map(entry => <button key={entry.id} type="button" className="rh-lookup-link min-w-0 text-left [overflow-wrap:anywhere]"
                  onClick={() => onResumeManualClick(entry)}>{draftLabel(entry)}</button>)}
              </div>
            </details>
          )}
          <button type="button" onClick={onManualClick}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-purple-600 hover:bg-gray-100">
            Add album manually
          </button>
          {discogsConfigured ? (
            <button type="button" className="rh-lookup-link" aria-description={`Import into your ${viewMode}.`}
              onClick={onImportClick}>Import from Discogs</button>
          ) : (
            <details className="rh-lookup-recovery min-w-0">
              <summary>Import from Discogs</summary>
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
