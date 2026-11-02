import { describe, expect, it } from 'vitest';
import { filterIdeas, sortIdeas, type IdeaMeta } from './ideas';

describe('filterIdeas with status filter', () => {
  const ideas: IdeaMeta[] = [
    {
      slug: 'report-1',
      title: 'Test Report 1',
      date: '2026-11-01',
      summary: 'Summary 1',
      tags: ['tech'],
      minutes: 5,
      format: 'markdown',
      status: 'new',
      pinned: false,
    },
    {
      slug: 'report-2',
      title: 'Test Report 2',
      date: '2026-11-02',
      summary: 'Summary 2',
      tags: ['finance'],
      minutes: 10,
      format: 'markdown',
      status: 'reading',
      pinned: true,
    },
    {
      slug: 'report-3',
      title: 'Test Report 3',
      date: '2026-10-30',
      summary: 'Summary 3',
      tags: ['tech', 'finance'],
      minutes: 15,
      format: 'markdown',
      status: 'archived',
      pinned: false,
    },
  ];

  it('filters by status', () => {
    const result = filterIdeas(ideas, new Set(), '', new Set(['reading']));
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('report-2');
  });

  it('hides archived by default', () => {
    const result = filterIdeas(ideas, new Set(), '', undefined, true);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.status === 'archived')).toBeUndefined();
  });

  it('shows archived when hideArchived is false', () => {
    const result = filterIdeas(ideas, new Set(), '', undefined, false);
    expect(result).toHaveLength(3);
  });

  it('combines status and tag filters', () => {
    const result = filterIdeas(ideas, new Set(['tech']), '', new Set(['new', 'archived']), false);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.slug === 'report-1')).toBeDefined();
    expect(result.find((i) => i.slug === 'report-3')).toBeDefined();
  });
});

describe('sortIdeas', () => {
  it('sorts pinned items first', () => {
    const ideas: IdeaMeta[] = [
      {
        slug: 'report-1',
        title: 'Test Report 1',
        date: '2026-11-02',
        summary: 'Summary 1',
        tags: [],
        minutes: 5,
        format: 'markdown',
        status: 'new',
        pinned: false,
      },
      {
        slug: 'report-2',
        title: 'Test Report 2',
        date: '2026-11-01',
        summary: 'Summary 2',
        tags: [],
        minutes: 5,
        format: 'markdown',
        status: 'new',
        pinned: true,
      },
    ];

    const result = sortIdeas(ideas);
    expect(result[0].slug).toBe('report-2'); // pinned comes first
    expect(result[1].slug).toBe('report-1');
  });

  it('sorts by date when pin status is equal', () => {
    const ideas: IdeaMeta[] = [
      {
        slug: 'report-1',
        title: 'Test Report 1',
        date: '2026-11-01',
        summary: 'Summary 1',
        tags: [],
        minutes: 5,
        format: 'markdown',
        status: 'new',
        pinned: false,
      },
      {
        slug: 'report-2',
        title: 'Test Report 2',
        date: '2026-11-02',
        summary: 'Summary 2',
        tags: [],
        minutes: 5,
        format: 'markdown',
        status: 'new',
        pinned: false,
      },
    ];

    const result = sortIdeas(ideas);
    expect(result[0].slug).toBe('report-2'); // newer date first
    expect(result[1].slug).toBe('report-1');
  });
});
