import { ModalDialog } from './ModalDialog';

interface AddMenuProps {
  onBarcodeClick: () => void;
  onImageClick: () => void;
  onSearchClick: () => void;
  onManualClick: () => void;
  onImportClick: () => void;
  onClose: () => void;
  discogsConfigured: boolean | null;
  discogsCheckFailed?: boolean;
  viewMode: 'collection' | 'wishlist';
}

export const AddMenu = ({
  onBarcodeClick, onImageClick, onSearchClick, onManualClick, onImportClick, onClose, discogsConfigured, discogsCheckFailed, viewMode,
}: AddMenuProps) => {
  const importIcon = (
    <span className={`shrink-0 rounded-lg p-3 ${discogsConfigured ? 'bg-blue-50 group-hover:bg-blue-100' : 'bg-gray-50'}`}>
      <svg className={`h-6 w-6 ${discogsConfigured ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    </span>
  );

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
              <span className="block text-sm text-gray-600">Find an artist or album in your library and the catalogs.</span>
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
              <span className="block text-sm text-gray-600">Scan with your camera or type the digits.</span>
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

          {discogsConfigured ? (
            <button type="button" className="rh-add-method group" onClick={onImportClick}>
              {importIcon}
              <span className="min-w-0">
                <span className="mb-1 block text-base font-semibold text-gray-900">Import from Discogs</span>
                <span className="block text-sm text-gray-600">Copy records from Discogs into your {viewMode}.</span>
              </span>
            </button>
          ) : (
            <div className="flex items-start gap-4 rounded-xl border border-gray-300 p-4">
              {importIcon}
              <div className="min-w-0">
                <p className="mb-1 text-base font-semibold text-gray-900">Import from Discogs</p>
                {discogsCheckFailed ? (
                  <p className="text-sm text-gray-600" role="status">Could not check the Discogs connection. You can still add records by name.</p>
                ) : discogsConfigured === null ? (
                  <p className="text-sm text-gray-600" role="status">Checking the Discogs connection…</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">Ask your server administrator to connect Discogs before importing.</p>
                    <a
                      href="https://github.com/mkurdziel/side-a-vinyl-collector#configuration"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
                    >
                      Discogs setup instructions
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 px-4 py-2 sm:px-6">
          <button type="button" onClick={onManualClick}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-purple-600 hover:bg-gray-100">
            Add album manually
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
