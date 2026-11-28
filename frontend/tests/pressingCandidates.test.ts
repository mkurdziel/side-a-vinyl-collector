import { createElement, useState } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PressingDetails } from '../src/services/api';
import { PressingCandidates, type PressingCandidate } from '../src/components/PressingCandidates';
import { createPressingDetailsLoader, sharedCatalogNumber } from '../src/services/pressingEvidence';

const { getPressingDetails } = vi.hoisted(() => ({ getPressingDetails: vi.fn() }));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { getPressingDetails },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const textOf = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => renderer!.root.findAllByType('button').find(control => textOf(control) === label)!;
const status = () => renderer!.root.findAllByProps({ role: 'status' }).map(textOf);
const radios = () => renderer!.root.findAllByProps({ type: 'radio' }).map(control => control.props.value);

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.resetAllMocks();
});

const choices: PressingCandidate[] = [
  { releaseId: 1, pressing: { catalogNumber: 'S-5233 · ALT-12', label: 'Alshire', format: 'LP · Stereo' } },
  { releaseId: 2, pressing: { catalogNumber: 'S 5233', label: 'Alshire', format: 'LP · Mono', country: 'Canada' } },
  { releaseId: 3, year: 1972, pressing: { catalogNumber: 'S-5233' } },
  { releaseId: 4, pressing: { catalogNumber: 'ALT-42' } },
  { releaseId: 5, pressing: { catalogNumber: 'ALT-55' } },
];

describe('pressing candidate evidence', () => {
  it('counts normalized numbers per distinct release and ignores placeholder values', () => {
    expect(sharedCatalogNumber([
      { releaseId: 1, pressing: { catalogNumber: 'CÁT-12 · CAT 12 · alt 1 · none' } },
      { releaseId: 2, pressing: { catalogNumber: 'CAT-12 · NONE' } },
      { releaseId: 3, pressing: { catalogNumber: 'ALT1 · None' } },
    ], 'cat 12')).toEqual({ number: 'cat 12', count: 2 });
    expect(sharedCatalogNumber([
      { releaseId: 1, pressing: { catalogNumber: 'none · ALT-1 · ALT 1' } },
      { releaseId: 2, pressing: { catalogNumber: 'NONE' } },
    ])).toBeUndefined();
  });

  it('shows evidence before a radio selection and only fetches runouts for visible pressings on request', async () => {
    const pending = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    const onSelect = vi.fn();
    getPressingDetails.mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ pressing: null })
      .mockResolvedValueOnce({ pressing: { matrixRunouts: [{ value: 'YEX-102' }] } });
    await act(async () => { renderer = create(createElement(PressingCandidates, { choices, onSelect, searchedNumber: 'S-5233' })); });
    const fieldset = renderer!.root.findByType('fieldset');
    expect(textOf(fieldset)).toContain('S-5233 is shared by 3 pressings in these results.');
    expect(textOf(fieldset)).toContain('LP · Mono');
    expect(radios()).toEqual([1, 2, 3]);
    expect(getPressingDetails).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => button('Compare runout markings').props.onClick());
    expect(getPressingDetails.mock.calls.map(([releaseId]) => releaseId)).toEqual([1, 2, 3]);
    expect(status()).toContain('Discogs release 1. Checking Discogs…');
    expect(status()).toContain('Discogs release 2. Couldn’t load runout markings.');
    expect(status()).toContain('Discogs release 3. Discogs lists no runout markings for this release.');

    await act(async () => pending.resolve({ pressing: { catalogNumber: 'ALTERNATE-11', country: 'US', matrixRunouts: [{ value: 'YEX-101' }] } }));
    await act(async () => button('Retry runout markings').props.onClick());
    expect(getPressingDetails.mock.calls.map(([releaseId]) => releaseId)).toEqual([1, 2, 3, 2]);
    expect(textOf(fieldset)).toContain('S-5233 is shared by 3 pressings in these results.');
    expect(textOf(fieldset)).toContain('S-5233 · ALT-12');
    expect(textOf(fieldset)).toContain('Country US');
    expect(textOf(fieldset)).toContain('YEX-101');
    expect(textOf(fieldset)).toContain('YEX-102');
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findByProps({ value: 2 }).props.onChange());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('aborts evidence reads for pressings that leave view', async () => {
    getPressingDetails.mockImplementation(() => new Promise(() => {}));
    await act(async () => { renderer = create(createElement(PressingCandidates, { choices, onSelect: vi.fn() })); });
    await act(async () => button('Compare runout markings').props.onClick());
    await act(async () => button('More pressings').props.onClick());
    expect(radios()).toEqual([4, 5]);
    expect(getPressingDetails.mock.calls.map(([releaseId]) => releaseId)).toEqual([1, 2, 3, 4, 5]);
    expect(getPressingDetails.mock.calls.map(([, signal]) => signal.aborted)).toEqual([true, true, true, false, false]);
    await act(async () => button('Hide runout markings').props.onClick());
    expect(getPressingDetails.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
  });

  it('keeps two pinned pressings and their evidence together across pages without selecting either', async () => {
    const firstRead = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    getPressingDetails.mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ pressing: { country: 'US', matrixRunouts: [{ value: 'RUNOUT-4' }] } });
    const onSelect = vi.fn();
    const pin = (number: string) => renderer!.root.findAllByType('button').find(control => (
      control.props['aria-label']?.startsWith(`Pin for comparison · ${number}`)
    ))!;
    function Chooser() {
      const [selectedId, setSelectedId] = useState<number>();
      return createElement(PressingCandidates, { choices, selectedId, onSelect: id => {
        onSelect(id);
        setSelectedId(id);
      } });
    }

    await act(async () => { renderer = create(createElement(Chooser)); });
    await act(async () => pin('S 5233').props.onClick());
    await act(async () => button('More pressings').props.onClick());
    expect(getPressingDetails.mock.calls[0][1].aborted).toBe(false);
    await act(async () => pin('ALT-42').props.onClick());
    await act(async () => firstRead.resolve({ pressing: { matrixRunouts: [{ value: 'RUNOUT-2' }] } }));
    const shortlist = renderer!.root.findByType('section');
    expect(textOf(shortlist)).toContain('LP · Mono');
    expect(textOf(shortlist)).toContain('Country US');
    expect(textOf(shortlist)).toContain('RUNOUT-2');
    expect(textOf(shortlist)).toContain('RUNOUT-4');
    expect(radios()).toEqual([4, 5]);
    expect(pin('ALT-55').props['aria-disabled']).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();

    const select = shortlist.findAllByType('button').find(control => control.props['aria-label']?.startsWith('Select pressing · S 5233'))!;
    await act(async () => select.props.onClick());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    await act(async () => button('Previous pressings').props.onClick());
    expect(renderer!.root.findByProps({ type: 'radio', value: 2 }).props.checked).toBe(true);
    expect(textOf(shortlist)).toContain('RUNOUT-4');
    expect(getPressingDetails.mock.calls.map(([releaseId]) => releaseId)).toEqual([2, 4]);

    await act(async () => button('More pressings').props.onClick());
    const unpin = shortlist.findAllByType('button').find(control => control.props['aria-label']?.startsWith('Unpin pressing · S 5233'))!;
    await act(async () => unpin.props.onClick());
    expect(textOf(renderer!.root.findByType('fieldset'))).toContain('Selected pressingS 5233Label Alshire · Country Canada · Format LP · Mono');
  });

  it('announces missing runouts once and keeps retry separate from known absence', async () => {
    getPressingDetails.mockResolvedValueOnce({ pressing: null })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ pressing: null });
    await act(async () => { renderer = create(createElement(PressingCandidates, {
      choices, onSelect: vi.fn(), uncertainAction: 'If you’re unsure, save the album without a pressing.',
    })); });
    await act(async () => button('Compare runout markings').props.onClick());
    expect(status()).toContain('Discogs release 2. Couldn’t load runout markings.');
    expect(status().some(message => message.includes('for these pressings'))).toBe(false);

    await act(async () => button('Retry runout markings').props.onClick());
    const missing = () => status().filter(message => message.includes('Discogs lists no runout markings'));
    expect(missing()).toEqual(['Discogs lists no runout markings for these pressings. Compare the format with your record. If you’re unsure, save the album without a pressing.']);

    await act(async () => button('More pressings').props.onClick());
    await act(async () => button('Pin for comparison').props.onClick());
    await act(async () => button('Pin for comparison').props.onClick());
    expect(radios()).toEqual([4, 5]);
    expect(missing()).toEqual(['Discogs lists no runout markings for these pressings. Check the label, country, format, and release year against your record. If you’re unsure, save the album without a pressing.']);
  });

  it('shares an in-flight and completed lookup with the comparison table without sharing cancellation', async () => {
    const request = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    getPressingDetails.mockReturnValueOnce(request.promise);
    const loadDetails = createPressingDetailsLoader();
    const first = new AbortController();
    const second = new AbortController();
    const firstRead = loadDetails(1, first.signal);
    const secondRead = loadDetails(1, second.signal);
    const sharedSignal: AbortSignal = getPressingDetails.mock.calls[0][1];
    expect(getPressingDetails).toHaveBeenCalledTimes(1);
    first.abort();
    await expect(firstRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(false);

    const evidence = { pressing: { matrixRunouts: [{ value: 'YEX-101' }] } };
    request.resolve(evidence);
    await expect(secondRead).resolves.toEqual(evidence);
    await expect(loadDetails(1, new AbortController().signal)).resolves.toEqual(evidence);
    expect(getPressingDetails).toHaveBeenCalledTimes(1);
  });
});
