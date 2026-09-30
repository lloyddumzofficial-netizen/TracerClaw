import { describe, expect, it } from 'vitest';
import { getRecoverableAttemptOutput } from '@/server/billing/recoverAttemptOutput';

describe('interrupted generation recovery', () => {
  const created_at = '2026-09-30T00:00:00.000Z';
  it('recovers a Flat Extract uploaded after its attempt started', () => {
    const url = `https://storage.example/projects/1/generated_flat_${Date.parse(created_at) + 1000}.png`;
    expect(getRecoverableAttemptOutput({ operation: 'trace', created_at }, { generated_image_url: url })).toBe(url);
  });
  it('does not settle a new attempt with an older project output', () => {
    const url = `https://storage.example/projects/1/generated_flat_${Date.parse(created_at) - 60_000}.png`;
    expect(getRecoverableAttemptOutput({ operation: 'trace', created_at }, { generated_image_url: url })).toBeNull();
  });
  it('recovers only a fresh SVG for Precision', () => {
    const url = `https://storage.example/projects/1/vector_${Date.parse(created_at) + 1000}.svg`;
    expect(getRecoverableAttemptOutput({ operation: 'precision_svg', created_at }, { svg_url: url })).toBe(url);
  });
});
