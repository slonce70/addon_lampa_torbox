
const ITERATIONS = 10000;

// Mocks
const raw = {
  Title: 'Some.Movie.Title.2023.HDR.2160p.WEB-DL.DDP5.1.Atmos.DV.MKV',
  PublishDate: '2023-10-27T10:00:00Z',
  info: { videotype: 'web-dl' },
  ffprobe: []
};

// --- Old Implementation Mocks ---

const UtilsOld = {
  formatAge(iso) {
    if (!iso) return 'n/a';
    const d = new Date(iso);
    if (isNaN(d)) return 'n/a';
    return '2 days ago'; // Mock calculation
  }
};

function toViewItemOld(raw) {
  const publishDate = raw?.PublishDate ? new Date(raw.PublishDate) : null;

  const tech = {
    has_hdr: /(^|\W)hdr(\W|$)/i.test(raw?.Title || '') || /hdr/i.test(raw?.info?.videotype || ''),
    has_dv: /(dv|dolby\s*vision)/i.test(raw?.Title || '') || /(dovi|dolby\s*vision)/i.test(raw?.info?.videotype || ''),
  };

  const age = UtilsOld.formatAge(raw?.PublishDate);
  const meta = `Added: ${UtilsOld.formatAge(raw?.PublishDate)}`;

  return { tech, age, meta, ts: publishDate ? publishDate.getTime() : 0 };
}

function sortOld(a, b) {
    const chunk = /(\d+)/g;
    const aa = a.name.split(chunk);
    const bb = b.name.split(chunk);
    return 0;
}

// --- New Implementation Mocks ---

const REGEX = {
    HDR: /(^|\W)hdr(\W|$)/i,
    HDR_TYPE: /hdr/i,
    DV: /(dv|dolby\s*vision)/i,
    DV_TYPE: /(dovi|dolby\s*vision)/i,
    CHUNK: /(\d+)/g
};

const UtilsNew = {
  formatAge(iso) {
    if (!iso) return 'n/a';
    const d = (iso instanceof Date) ? iso : new Date(iso);
    if (isNaN(d)) return 'n/a';
    return '2 days ago';
  }
};

function toViewItemNew(raw) {
  const publishDate = raw?.PublishDate ? new Date(raw.PublishDate) : null;

  const tech = {
    has_hdr: REGEX.HDR.test(raw?.Title || '') || REGEX.HDR_TYPE.test(raw?.info?.videotype || ''),
    has_dv: REGEX.DV.test(raw?.Title || '') || REGEX.DV_TYPE.test(raw?.info?.videotype || ''),
  };

  const age = publishDate ? UtilsNew.formatAge(publishDate) : 'n/a';
  const meta = `Added: ${age}`;

  return { tech, age, meta, ts: publishDate ? publishDate.getTime() : 0 };
}

function sortNew(a, b) {
    const aa = a.name.split(REGEX.CHUNK);
    const bb = b.name.split(REGEX.CHUNK);
    return 0;
}


// --- Benchmarks ---

console.log('Running benchmarks...');

// 1. toViewItem
const start1 = performance.now();
for(let i=0; i<ITERATIONS; i++) {
    toViewItemOld(raw);
}
const end1 = performance.now();
console.log(`toViewItem Old: ${(end1 - start1).toFixed(2)}ms`);

const start2 = performance.now();
for(let i=0; i<ITERATIONS; i++) {
    toViewItemNew(raw);
}
const end2 = performance.now();
console.log(`toViewItem New: ${(end2 - start2).toFixed(2)}ms`);


// 2. Sort
const itemA = { name: 'Episode 1' };
const itemB = { name: 'Episode 2' };

const start3 = performance.now();
for(let i=0; i<ITERATIONS; i++) {
    sortOld(itemA, itemB);
}
const end3 = performance.now();
console.log(`Sort Old: ${(end3 - start3).toFixed(2)}ms`);

const start4 = performance.now();
for(let i=0; i<ITERATIONS; i++) {
    sortNew(itemA, itemB);
}
const end4 = performance.now();
console.log(`Sort New: ${(end4 - start4).toFixed(2)}ms`);
