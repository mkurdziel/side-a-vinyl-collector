import { createElement, useState, type ComponentProps } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PressingDetails } from '../src/services/api';
import { PressingCandidates, PressingSelectionSummary, type PressingCandidate } from '../src/components/PressingCandidates';
import { createPressingDetailsLoader, sharedCatalogNumber, summarizePressingFormat } from '../src/services/pressingEvidence';

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
const radioLabels = () => renderer!.root.findAllByType('label').filter(node => node.findAllByProps({ type: 'radio' }).length > 0);

function CandidatePicker(props: Omit<ComponentProps<typeof PressingCandidates>, 'medium' | 'onMediumChange'>) {
  const [medium, setMedium] = useState('');
  return createElement(PressingCandidates, { ...props, medium, onMediumChange: setMedium });
}

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
  it('compares physical fields before selection without treating an unlisted mix as a difference', async () => {
    await act(async () => {
      renderer = create(createElement(CandidatePicker, {
        choices: [
          { releaseId: 21, pressing: { catalogNumber: 'S 5233', format: 'Vinyl · LP · Album', country: 'Canada' } },
          { releaseId: 22, pressing: { catalogNumber: 'S-5233', format: 'Vinyl · LP · Stereo', country: 'US' } },
        ],
        savedReleaseId: 22,
        onSelect: vi.fn(),
      }));
    });
    const comparison = renderer!.root.findByType('table');
    expect(textOf(comparison.findByType('thead'))).toContain('Saved pressing 22');
    expect(textOf(comparison.findByType('thead'))).toContain('Suggested pressing 21');
    const evidenceRows = comparison.findByType('tbody').findAllByType('tr');
    expect(evidenceRows.map(textOf)).toEqual(['CountryDiffersUSCanada', 'FormatVinylVinyl', 'MixStereoUnlisted']);
    expect(evidenceRows.map(row => row.props.className)).toEqual(['rh-evidence-priority', undefined, undefined]);
    expect(renderer!.root.findAllByProps({ type: 'radio' }).every(radio => !radio.props.checked)).toBe(true);
  });

  it('surfaces a long format qualifier when its shorter sibling already fits', () => {
    const mono = 'Vinyl · LP · Album · Reissue · Mono';
    const stereo = 'Vinyl · LP · Album · Reissue · Remastered · Stereo';
    expect(summarizePressingFormat(stereo, [mono, stereo], 36)).toBe('Vinyl · LP · Remastered · Stereo');
    expect(summarizePressingFormat(mono, [mono, stereo], 36)).toContain('Mono');
  });

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

  it('puts matching numbers and distinguishing physical facts ahead of long Discogs credits', async () => {
    const credits = 'Apple Records · Universal Music Group · EMI Records · Capitol Records · Abbey Road Studios · Calderstone Productions · Optimal Media GmbH · Universal Music Operations';
    const vinyl: PressingCandidate = {
      releaseId: 9269057, year: 2016,
      pressing: { catalogNumber: '0602547298819 · PCS 7088', format: 'Vinyl · LP · Album', country: 'UK & Ireland', label: credits },
    };
    const compactDisc: PressingCandidate = {
      releaseId: 1840188, year: 1987,
      pressing: { catalogNumber: 'PCS 7088', format: 'CD · Album', country: 'Japan', label: credits },
    };
    const matching = [vinyl, ...choices.slice(0, 2), compactDisc];
    getPressingDetails.mockResolvedValue({ pressing: null });
    await act(async () => {
      renderer = create(createElement(CandidatePicker, { choices: matching, onSelect: vi.fn(), searchedNumber: 'PCS 7088' }));
    });

    const vinylRadio = radioLabels()[0];
    expect(textOf(vinylRadio)).toMatch(/Catalog number PCS 7088.*Format Vinyl · LP · Album.*Country UK & Ireland.*Release year 2016.*Discogs release 9269057.*Label Apple Records/);
    expect(textOf(vinylRadio)).not.toContain('Universal Music Group');
    expect(renderer!.root.findAllByType('details').map(textOf)).toEqual([expect.stringContaining('Where to check your record')]);
    await act(async () => button('Listing details and pins').props.onClick());
    const listing = renderer!.root.findAllByType('details').find(node => textOf(node).includes('release 9269057'))!;
    expect(listing.props.open).toBeUndefined();
    expect(textOf(listing)).toContain(credits);
    expect(textOf(listing)).toContain('0602547298819 · PCS 7088');
    const pinVinyl = renderer!.root.findByProps({ 'aria-label': 'Pin for comparison · PCS 7088, Vinyl · LP · Album, UK & Ireland, 2016, Discogs release 9269057' });
    await act(async () => pinVinyl.props.onClick());
    await act(async () => button('More pressings').props.onClick());

    const cdRadio = radioLabels()[0];
    expect(textOf(cdRadio)).toMatch(/Catalog number PCS 7088.*Format CD · Album.*Country Japan.*Release year 1987.*Discogs release 1840188/);
    const pinCd = renderer!.root.findByProps({ 'aria-label': 'Pin for comparison · PCS 7088, CD · Album, Japan, 1987, Discogs release 1840188' });
    await act(async () => pinCd.props.onClick());
    const shortlist = renderer!.root.findByType('section');
    expect(shortlist.findByProps({ 'aria-label': 'Select pressing · PCS 7088, CD · Album, Japan, 1987, Discogs release 1840188' })).toBeDefined();
    expect(shortlist.findByProps({ 'aria-label': 'Unpin pressing · PCS 7088, Vinyl · LP · Album, UK & Ireland, 2016, Discogs release 9269057' })).toBeDefined();

    await act(async () => renderer!.update(createElement(PressingSelectionSummary, {
      choice: vinyl, searchedNumber: 'PCS 7088', compact: true,
    })));
    expect(textOf(renderer!.root)).toMatch(/Catalog number PCS 7088.*Format Vinyl · LP · Album.*Country UK & Ireland.*Release year 2016.*Discogs release 9269057/);
    expect(textOf(renderer!.root)).not.toContain('Apple Records');
    expect(renderer!.root.findAllByType('details')).toHaveLength(0);
  });

  it('surfaces distinguishing format qualifiers and groups full facts with the Discogs link', async () => {
    const prefix = 'Vinyl · LP · Album · Reissue · Limited Edition';
    const formats = [`${prefix} · Remastered · Stereo`, `${prefix} · Mono`];
    const onSelect = vi.fn();
    await act(async () => {
      renderer = create(createElement(CandidatePicker, {
        choices: formats.map((format, index) => ({
          releaseId: index + 10, pressing: { catalogNumber: 'PCS 7088', format },
        })),
        onSelect,
      }));
    });

    expect(radioLabels().map(textOf)).toEqual([
      expect.stringContaining('Format Vinyl · LP · Remastered · Stereo'),
      expect.stringContaining('Format Vinyl · LP · Mono'),
    ]);
    expect(radioLabels().map(textOf).every(label => !label.includes('Limited Edition'))).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => button('Listing details').props.onClick());
    const rows = renderer!.root.findAllByType('li');
    rows.forEach((row, index) => {
      const listing = row.findByType('details');
      expect(listing.props.open).toBeUndefined();
      expect(textOf(listing.findByType('summary'))).toBe(`Listing details for Discogs release ${index + 10}`);
      expect(listing.findByType('a').props.href).toBe(`https://www.discogs.com/release/${index + 10}`);
      expect(row.findAllByType('a')).toEqual([listing.findByType('a')]);
      expect(textOf(listing)).toContain(formats[index]);
    });
  });

  it('narrows a mixed-media list by actual medium without dropping a pin or selection', async () => {
    const matching = [
      { releaseId: 1, pressing: { format: 'Vinyl · LP · Album' } },
      { releaseId: 2, pressing: { format: 'Vinyl · 12" · Reissue' } },
      { releaseId: 3, pressing: { format: 'Cassette · Album' } },
      { releaseId: 4, pressing: { format: 'CD · Album' } },
      { releaseId: 5, pressing: { format: 'Vinyl · CD · Limited Edition' } },
    ];
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSelect = vi.fn();
    await act(async () => {
      renderer = create(createElement(CandidatePicker, { choices: matching, selectedId: 2, onSelect }));
    });
    const mediumFilter = renderer!.root.findByType('select');
    expect(mediumFilter.findAllByType('option').map(textOf)).toEqual(['All media', 'Vinyl', 'Cassette', 'CD']);
    await act(async () => button('Listing details and pins').props.onClick());
    await act(async () => button('Pin').props.onClick());
    await act(async () => mediumFilter.props.onChange({ target: { value: 'CD' } }));
    expect(radios()).toEqual([4, 5]);
    expect(status()).toContain('2 CD pressings');
    expect(textOf(renderer!.root.findByType('table').findByType('thead'))).toBe('EvidenceSelected pressing outside filter 2');
    expect(textOf(renderer!.root.findByType('section'))).toContain('Discogs release 1');
    expect(button('Show selected pressing in All media')).toBeDefined();
    const pinnedSelection = renderer!.root.findAllByType('button').find(control => control.props['aria-label']?.startsWith('Select pressing ·'))!;
    expect(pinnedSelection.props['aria-disabled']).toBe(true);
    await act(async () => pinnedSelection.props.onClick());
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => button('Show selected pressing in All media').props.onClick());
    expect(mediumFilter.props.value).toBe('');
    expect(renderer!.root.findByProps({ type: 'radio', value: 2 }).props.checked).toBe(true);
    await act(async () => mediumFilter.props.onChange({ target: { value: 'Vinyl' } }));
    expect(radios()).toEqual([1, 2, 5]);
    expect(renderer!.root.findByProps({ type: 'radio', value: 2 }).props.checked).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('links the preview to the correct radio without selecting it and distinguishes saved and selected pressings', async () => {
    const onSelect = vi.fn();
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const savedReleaseId = 1;
    const picker = (selectedId?: number) => createElement(CandidatePicker, { choices, savedReleaseId, selectedId, onSelect });
    await act(async () => {
      renderer = create(picker(), { createNodeMock: node => node.type === 'ul' ? { querySelector } : null });
    });
    const preview = () => textOf(renderer!.root.findByType('table').findByType('thead'));
    expect(preview()).toBe('EvidenceSaved pressing 1Suggested pressing 2');
    expect(textOf(radioLabels()[1])).toContain('Suggested pressing');
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Suggested pressing · Find in list' }).props.onClick());
    expect(querySelector).toHaveBeenCalledExactlyOnceWith('input[value="2"]');
    expect(focus).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ type: 'radio', value: 2 }).props.checked).toBe(false);

    await act(async () => renderer!.update(picker(2)));
    expect(preview()).toBe('EvidenceSaved pressing 1Selected pressing 2');
    expect(textOf(radioLabels()[1])).toContain('Selected pressing');
    expect(renderer!.root.findByProps({ type: 'radio', value: 2 }).props.checked).toBe(true);

    await act(async () => renderer!.update(picker(1)));
    expect(preview()).toBe('EvidenceSaved pressing selected 1');
    expect(textOf(radioLabels()[0])).toContain('Saved pressing selected');
    expect(textOf(renderer!.root.findByType('table'))).not.toContain('Differs');
  });

  it('shows evidence before a radio selection and only fetches runouts for visible pressings on request', async () => {
    const pending = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    const onSelect = vi.fn();
    getPressingDetails.mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ pressing: null })
      .mockResolvedValueOnce({ pressing: { matrixRunouts: [{ value: 'YEX-102' }] } });
    await act(async () => { renderer = create(createElement(CandidatePicker, { choices, onSelect, searchedNumber: 'S-5233' })); });
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
    await act(async () => button('Listing details and pins').props.onClick());
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
    await act(async () => { renderer = create(createElement(CandidatePicker, { choices, onSelect: vi.fn() })); });
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
      return createElement(CandidatePicker, { choices, selectedId, onSelect: id => {
        onSelect(id);
        setSelectedId(id);
      } });
    }

    await act(async () => { renderer = create(createElement(Chooser)); });
    await act(async () => button('Listing details and pins').props.onClick());
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
    const offPage = renderer!.root.findByType(PressingSelectionSummary);
    expect(textOf(offPage)).toMatch(/Selected pressing.*S 5233.*Format LP · Mono.*Country Canada.*Discogs release 2.*Label Alshire/);
  });

  it('announces missing runouts once and keeps retry separate from known absence', async () => {
    getPressingDetails.mockResolvedValueOnce({ pressing: null })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ pressing: null });
    await act(async () => { renderer = create(createElement(CandidatePicker, {
      choices, onSelect: vi.fn(), uncertainAction: 'If you’re unsure, save the album without a pressing.',
    })); });
    await act(async () => button('Compare runout markings').props.onClick());
    expect(status()).toContain('Discogs release 2. Couldn’t load runout markings.');
    expect(status().some(message => message.includes('for these pressings'))).toBe(false);

    await act(async () => button('Retry runout markings').props.onClick());
    const missing = () => status().filter(message => message.includes('Discogs lists no runout markings'));
    expect(missing()).toEqual(['Discogs lists no runout markings for these pressings. Compare the format with your record. If you’re unsure, save the album without a pressing.']);

    await act(async () => button('More pressings').props.onClick());
    await act(async () => button('Listing details and pins').props.onClick());
    await act(async () => button('Pin').props.onClick());
    await act(async () => button('Pin').props.onClick());
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
