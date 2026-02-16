import { useState, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { API_URL } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    try {
      toast.loading('Preparing backup...', { id: 'export' });
      
      // We can't use fetch for download easily if we want to trigger browser download behavior
      // A simple window.location.href or opening in new tab is easiest for GET downloads
      // But we can also fetch as blob and create object URL
      
      const response = await fetch(`${API_URL}/api/backup/export`);
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename from header if possible, or generate default
      const disposition = response.headers.get('Content-Disposition');
      let filename = 'vinyl-backup.zip';
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
        }
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success('Backup downloaded successfully', { id: 'export' });
    } catch (error) {
      console.error(error);
      toast.error('Failed to export data', { id: 'export' });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input
    e.target.value = '';

    if (!confirm('WARNING: Importing a backup will overwrite ALL existing data. This cannot be undone. Are you sure?')) {
      return;
    }

    setIsImporting(true);
    const toastId = toast.loading('Restoring backup... This may take a while.');

    try {
      const formData = new FormData();
      formData.append('backup', file);

      const response = await fetch(`${API_URL}/api/backup/import`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Import failed');
      }

      toast.success(`Backup restored! ${data.stats?.albums || 0} albums restored.`, { id: toastId });
      
      // Ideally reload page to refresh data
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Failed to import backup', { id: toastId });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Data Management Section */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Data Management
            </h3>
            
            <div className="bg-gray-50 rounded-lg p-4 space-y-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Export Data</p>
                  <p className="text-sm text-gray-500">Download a full backup of your collection and artwork.</p>
                </div>
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm"
                >
                  Export
                </button>
              </div>

              <div className="border-t border-gray-200 pt-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Import Data</p>
                  <p className="text-sm text-gray-500">Restore your collection from a backup file.</p>
                </div>
                <button
                  onClick={handleImportClick}
                  disabled={isImporting}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {isImporting ? 'Importing...' : 'Import'}
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".zip"
                  onChange={handleFileChange}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-start gap-2">
              <span className="text-lg leading-none">⚠️</span>
              Importing data will <strong>overwrite correctly existing data</strong>. Please verify your backup file before proceeding.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
