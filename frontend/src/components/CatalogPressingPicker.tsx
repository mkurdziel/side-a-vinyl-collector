import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { discogsReleaseSource } from '../albumDisplay';
import api, { type Album, type DiscogsAlbum, type PressingDetails } from '../services/api';
import { ModalDialog } from './ModalDialog';

interface Props {
  album: DiscogsAlbum;
  destination: Album['status'];
  issue?: string;
  duplicate?: boolean;
  onClose: () => void;
  onSave: (release: DiscogsAlbum) => Promise<boolean>;
  onOpenDuplicate?: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  fallback: RefObject<HTMLElement | null>;
}

type RunoutResult = { status: 'loading' | 'failed' } | { status: 'ready'; markings: NonNullable<PressingDetails['matrixRunouts']> };

function CatalogRunoutEvidence({ releaseId }: { releaseId: number }) {
  const summary = useRef<HTMLElement>(null);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<RunoutResult>({ status: 'loading' });

  useEffect(() => {
    if (!requested) return;
    const request = new AbortController();
    void api.getPressingDetails(releaseId, request.signal).then(({ pressing }) => {
      if (!request.signal.aborted) setResult({ status: 'ready', markings: pressing?.matrixRunouts ?? [] });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ status: 'failed' });
    });
    return () => request.abort();
  }, [releaseId, requested, attempt]);

  const markings = result.status === 'ready' ? result.markings : [];
  const message = result.status === 'loading' ? 'Checking Discogs for runout markings…'
    : result.status === 'failed' ? 'Couldn’t load runout markings.'
      : markings.length ? 'Runout markings loaded.' : 'Discogs returned no runout markings for this pressing.';

  return (
    <details className="basis-full pl-5 text-sm [overflow-wrap:anywhere]" onToggle={event => {
      if (event.currentTarget.open) setRequested(true);
    }}>
      <summary ref={summary} className="min-h-11 cursor-pointer content-center font-medium">Check runout markings</summary>
      {requested && (
        <div className="space-y-2 pb-3">
          <p className="text-gray-600">Look for etched or stamped characters in the smooth band between the last track and the center label.</p>
          <p role="status" className={markings.length ? 'sr-only' : 'text-gray-600'}>{message}</p>
          {result.status === 'failed' && <button type="button" className="rh-lookup-link -ml-2" onClick={() => {
            summary.current?.focus({ preventScroll: true });
            setResult({ status: 'loading' });
            setAttempt(current => current + 1);
          }}>Retry runout markings</button>}
          {markings.length > 0 && (
            <ul className="space-y-1">
              {markings.map(({ value, description }) => (
                <li key={`${description ?? ''}:${value}`}>
                  <span className="font-medium">{value}</span>
                  {description && <span className="ml-2 text-gray-600">{description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

export function CatalogPressingPicker({ album, destination, issue, duplicate, onClose, onSave, onOpenDuplicate, opener, fallback }: Props) {
  const headingId = useId();
  const radioName = useId();
  const [selectedId, setSelectedId] = useState<number>();
  const [saving, setSaving] = useState(false);
  const choices = album.pressingChoices?.length ? album.pressingChoices : [album];
  const pressing = choices.find(choice => choice.discogsId === selectedId);
  const numbers = choices.map(choice => choice.pressing?.catalogNumber?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
  const sharedNumber = numbers.some((number, index) => number && numbers.indexOf(number) !== index);
  const shelf = destination === 'collection' ? 'Collection' : 'Wishlist';
  const close = () => { if (!saving) onClose(); };

  return (
    <ModalDialog labelledBy={headingId} onClose={close} returnFocusTo={opener} fallbackFocusTo={fallback}>
      <div className="rh-dialog-panel rh-pressing-picker max-w-xl">
        <header className="rh-dialog-header flex items-start justify-between gap-2 border-b border-gray-200 p-4 sm:px-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id={headingId} className="text-xl font-semibold">Check the pressing</h2>
            <p className="mt-1 text-sm text-gray-600">{album.album} · {album.artist}</p>
          </div>
          <button type="button" className="rh-dialog-close" aria-label="Close pressing choices" onClick={close} aria-disabled={saving}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <form className="grid gap-3 p-4 sm:px-6" onSubmit={async event => {
          event.preventDefault();
          if (!pressing || saving || duplicate) return;
          setSaving(true);
          if (await onSave(pressing)) onClose();
          else setSaving(false);
        }}>
          <div className="space-y-1 text-sm text-gray-600">
            <p>{sharedNumber
              ? 'Some of these pressings share a catalog number. Check the label, country, format, and any runout markings before choosing.'
              : 'Compare the catalog number, label, and format with your sleeve or record.'}</p>
            <p>If you’re unsure, return to results to save the album without choosing a pressing.</p>
          </div>
          <fieldset disabled={saving || duplicate}>
            <legend className="mb-1 text-sm font-semibold">Pressing from Discogs</legend>
            {choices.map(choice => {
              const source = discogsReleaseSource(choice.discogsId);
              const details = choice.pressing;
              const edition = [details?.format, details?.country, choice.year ?? details?.year].filter(Boolean).join(' · ');
              return (
                <div key={choice.discogsId} className="rh-pressing-choice">
                  <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 py-2 text-sm [overflow-wrap:anywhere]">
                    <input type="radio" name={radioName} value={choice.discogsId} checked={selectedId === choice.discogsId}
                      className="mt-1 shrink-0" onChange={() => setSelectedId(choice.discogsId)} />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="font-semibold">{[details?.catalogNumber || 'Catalog number unavailable', details?.label].filter(Boolean).join(' · ')}</span>
                      <span className="text-gray-600">{edition || 'No format, country, or year listed'}</span>
                      {choice.catalogNumberMatch === 'unverified' && <span className="text-gray-600">Check the number on the listing.</span>}
                      {source?.url && <span className="sr-only"> · Discogs release {choice.discogsId}</span>}
                    </span>
                  </label>
                  {source?.url && <a className="rh-comparison-source" href={source.url} target="_blank" rel="noreferrer">
                    Discogs {choice.discogsId}<span className="sr-only"> (opens in a new tab)</span>
                  </a>}
                  {source?.url && selectedId === choice.discogsId && <CatalogRunoutEvidence releaseId={choice.discogsId} />}
                </div>
              );
            })}
          </fieldset>
          {issue && <p role="alert" className="text-sm text-red-600">{issue}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="rh-lookup-link" onClick={close} aria-disabled={saving}>Back to results</button>
            {onOpenDuplicate && duplicate ? <button type="button" className="rh-primary-action px-3 text-sm font-semibold"
              onClick={onOpenDuplicate}>Open saved album</button> : (
              <button type="submit" className="rh-primary-action px-3 text-sm font-semibold" aria-busy={saving}
                aria-disabled={!pressing || saving || duplicate}>
                {saving ? `Saving to ${shelf}…` : `Save pressing to ${shelf}`}
              </button>
            )}
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
