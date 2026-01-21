interface AddMenuProps {
  onBarcodeClick: () => void;
  onImageClick: () => void;
  onSearchClick: () => void;
  onImportClick: () => void;
  onClose: () => void;
  discogsConfigured: boolean;
}

export const AddMenu = ({ onBarcodeClick, onImageClick, onSearchClick, onImportClick, onClose, discogsConfigured }: AddMenuProps) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900">Add Album</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-8">
      <button
        className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow p-6 text-left group flex items-start gap-4"
        onClick={onBarcodeClick}
      >
        <div className="p-3 bg-violet-50 rounded-lg group-hover:bg-violet-100 transition-colors">
          <svg className="w-6 h-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        </div>
        <div>
          <span className="block text-base font-semibold text-gray-900 mb-1">Scan Barcode</span>
          <span className="block text-sm text-gray-600">Use camera to scan UPC/EAN</span>
        </div>
      </button>

      <button
        className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow p-6 text-left group flex items-start gap-4"
        onClick={onImageClick}
      >
        <div className="p-3 bg-pink-50 rounded-lg group-hover:bg-pink-100 transition-colors">
          <svg className="w-6 h-6 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <span className="block text-base font-semibold text-gray-900 mb-1">Upload Image</span>
          <span className="block text-sm text-gray-600">AI vision recognition</span>
        </div>
      </button>

      <button
        className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow p-6 text-left group flex items-start gap-4"
        onClick={onSearchClick}
      >
        <div className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
          <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div>
          <span className="block text-base font-semibold text-gray-900 mb-1">Search by Name</span>
          <span className="block text-sm text-gray-600">Search Discogs database</span>
        </div>
      </button>

      <button
        className={`bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow p-6 text-left group flex items-start gap-4 ${!discogsConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={discogsConfigured ? onImportClick : undefined}
        disabled={!discogsConfigured}
      >
        <div className={`p-3 rounded-lg transition-colors ${discogsConfigured ? 'bg-green-50 group-hover:bg-green-100' : 'bg-gray-50'}`}>
          <svg className={`w-6 h-6 ${discogsConfigured ? 'text-green-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div>
          <span className="block text-base font-semibold text-gray-900 mb-1">Import from Discogs</span>
          <span className="block text-sm text-gray-600">
            {discogsConfigured ? 'Import your Discogs collection' : 'Discogs token not configured'}
          </span>
        </div>
      </button>
        </div>
      </div>
    </div>
  );
};
