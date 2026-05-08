// Representative fixture rows mirroring the Neon `runs` table shape.
// Covers: overlapping vocabulary across rows, multiple style_mode values,
// different mode integers, and a null title.
// Date values are JS Date objects to match what the `postgres` driver returns.

export const fixtureRuns = [
  {
    id: 1001,
    date: new Date('2025-11-01'),
    sentence: 'The surface remembers every footprint that crossed it.',
    title: 'Surface Memory',
    mode: 1,
    style_mode: 'LIMINAL',
    video_url: 'https://example.com/v1.mp4',
    datamosh_url: 'https://example.com/v1-mosh.mp4',
  },
  {
    id: 1002,
    date: new Date('2025-12-15'),
    sentence: 'Beneath the surface, a slower current carries older debris.',
    title: 'Slow Current',
    mode: 2,
    style_mode: 'LIMINAL',
    video_url: 'https://example.com/v2.mp4',
    datamosh_url: null,
  },
  {
    id: 1003,
    date: new Date('2026-01-20'),
    sentence: 'Texture against texture: rough wool dragged across wet glass.',
    title: 'Texture Study',
    mode: 1,
    style_mode: 'SENSORY/TEXTURAL',
    video_url: 'https://example.com/v3.mp4',
    datamosh_url: 'https://example.com/v3-mosh.mp4',
  },
  {
    id: 1004,
    date: new Date('2026-02-08'),
    sentence: 'A condensed proposition: form follows pressure follows form.',
    title: null, // null title case
    mode: 3,
    style_mode: 'ABSTRACT',
    video_url: 'https://example.com/v4.mp4',
    datamosh_url: 'https://example.com/v4-mosh.mp4',
  },
  {
    id: 1005,
    date: new Date('2026-03-30'),
    sentence: 'The room replete with surface — every wall a record of its weather.',
    title: 'Replete Room',
    mode: 2,
    style_mode: 'REPLETE',
    video_url: null,
    datamosh_url: 'https://example.com/v5-mosh.mp4',
  },
]
