interface AddMenuProps {
  onBarcodeClick: () => void;
  onImageClick: () => void;
  onSearchClick: () => void;
}

export const AddMenu = ({ onBarcodeClick, onImageClick, onSearchClick }: AddMenuProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      <button
        className="glass-card-hover p-6 text-left group flex items-start gap-4"
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
        className="glass-card-hover p-6 text-left group flex items-start gap-4"
        onClick={onImageClick}
      >
        <div className="p-3 bg-pink-50 rounded-lg group-hover:bg-pink-100 transition-colors">
          <svg className="w-6 h-6 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <span className="block text-base font-semibold text-gray-900 mb-1">Upload Image</span>
          <span className="block text-sm text-gray-600">AI recognition with Claude</span>
        </div>
      </button>

      <button
        className="glass-card-hover p-6 text-left group flex items-start gap-4"
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
    </div>
  );
};
