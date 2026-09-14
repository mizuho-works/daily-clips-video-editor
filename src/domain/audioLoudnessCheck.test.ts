import { describe, expect, it } from 'vitest';
import { analyzeSceneLoudness, LOUDNESS_FLAG_THRESHOLD_DB } from './audioLoudnessCheck';
import type { MediaAsset, Project, Scene, VideoLayer } from './types';

function makeProject(scenes: Scene[], mediaLibrary: MediaAsset[]): Project {
  return {
    id: 'p',
    name: 'p',
    createdAt: 0,
    updatedAt: 0,
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    scenes,
    mediaLibrary,
    burnDateEnabled: false,
    burnDatePosition: 'left',
  };
}

function makeAsset(id: string, audioLoudnessDb: number | undefined): MediaAsset {
  return { id, kind: 'video', name: `${id}.mp4`, createdAt: 0, sizeBytes: 0, audioLoudnessDb };
}

function makeVideoLayer(mediaId: string): VideoLayer {
  return {
    id: `layer-${mediaId}`,
    type: 'video',
    mediaId,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    trimStart: 0,
    volume: 1,
    muted: false,
  };
}

function makeScene(id: string, mediaId: string): Scene {
  return { id, duration: 5000, layers: [makeVideoLayer(mediaId)] };
}

describe('analyzeSceneLoudness', () => {
  it('returns an empty array when fewer than 2 scenes have measurable audio', () => {
    const assets = [makeAsset('a', -20)];
    const scenes = [makeScene('s1', 'a')];
    expect(analyzeSceneLoudness(makeProject(scenes, assets))).toEqual([]);
  });

  it('flags a scene whose audio is far quieter than the rest', () => {
    // 3本中2本は-20dB前後、1本だけ-40dB(かなり小さい)。
    const assets = [makeAsset('a', -20), makeAsset('b', -21), makeAsset('c', -40)];
    const scenes = [makeScene('s1', 'a'), makeScene('s2', 'b'), makeScene('s3', 'c')];

    const result = analyzeSceneLoudness(makeProject(scenes, assets));

    expect(result).toHaveLength(3);
    const quiet = result.find((r) => r.sceneId === 's3')!;
    expect(quiet.flagged).toBe(true);
    expect(quiet.deviationDb).toBeLessThan(-LOUDNESS_FLAG_THRESHOLD_DB);
    const normal = result.find((r) => r.sceneId === 's1')!;
    expect(normal.flagged).toBe(false);
  });

  it('flags a scene whose audio is far louder than the rest', () => {
    const assets = [makeAsset('a', -20), makeAsset('b', -19), makeAsset('c', -5)];
    const scenes = [makeScene('s1', 'a'), makeScene('s2', 'b'), makeScene('s3', 'c')];

    const result = analyzeSceneLoudness(makeProject(scenes, assets));

    const loud = result.find((r) => r.sceneId === 's3')!;
    expect(loud.flagged).toBe(true);
    expect(loud.deviationDb).toBeGreaterThan(LOUDNESS_FLAG_THRESHOLD_DB);
  });

  it('does not flag scenes within the threshold of the median', () => {
    const assets = [makeAsset('a', -20), makeAsset('b', -22), makeAsset('c', -24)];
    const scenes = [makeScene('s1', 'a'), makeScene('s2', 'b'), makeScene('s3', 'c')];

    const result = analyzeSceneLoudness(makeProject(scenes, assets));

    expect(result.every((r) => !r.flagged)).toBe(true);
  });

  it('excludes scenes with no measurable audio from the comparison entirely', () => {
    const assets = [makeAsset('a', -20), makeAsset('b', -21), makeAsset('c', undefined)];
    const scenes = [makeScene('s1', 'a'), makeScene('s2', 'b'), makeScene('s3', 'c')];

    const result = analyzeSceneLoudness(makeProject(scenes, assets));

    expect(result.map((r) => r.sceneId).sort()).toEqual(['s1', 's2']);
  });

  it('excludes scenes with no video layer (e.g. text/shape-only scenes)', () => {
    const assets = [makeAsset('a', -20), makeAsset('b', -21)];
    const scenes: Scene[] = [makeScene('s1', 'a'), makeScene('s2', 'b'), { id: 's3', duration: 2000, layers: [] }];

    const result = analyzeSceneLoudness(makeProject(scenes, assets));

    expect(result.map((r) => r.sceneId).sort()).toEqual(['s1', 's2']);
  });
});
