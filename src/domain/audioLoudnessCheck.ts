import type { MediaAsset, Project, Scene } from './types';

/** 平均的な音量から見て「極端に」大きい/小さいと判定するしきい値(dB)。 */
export const LOUDNESS_FLAG_THRESHOLD_DB = 8;

export interface SceneLoudnessInfo {
  sceneId: string;
  sceneIndex: number;
  mediaName: string;
  loudnessDb: number;
  /** プロジェクト全体(比較対象シーン)の中央値からの差。プラス=平均より大きい、マイナス=小さい。 */
  deviationDb: number;
  /** LOUDNESS_FLAG_THRESHOLD_DB以上ずれている(極端に大きい/小さい)。 */
  flagged: boolean;
}

function getSceneMainVideoAsset(scene: Scene, mediaLibrary: MediaAsset[]): MediaAsset | undefined {
  const mainLayer = scene.layers.filter((l) => l.type === 'video').sort((a, b) => a.zIndex - b.zIndex)[0];
  if (!mainLayer) return undefined;
  return mediaLibrary.find((m) => m.id === mainLayer.mediaId);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 各シーンの主役動画の音量(loudnessDb、取り込み時にaudioLoudness.tsで解析済み)を
 * プロジェクト全体(比較可能なシーンの間)の中央値と比べ、極端に(LOUDNESS_FLAG_
 * THRESHOLD_DB以上)大きい/小さいシーンを検知する。音声が無い/解析できなかった
 * シーンは比較対象から除外する。比較できるシーンが2件未満なら空配列を返す
 * (比べる相手がいないため)。
 */
export function analyzeSceneLoudness(project: Project): SceneLoudnessInfo[] {
  const entries: { scene: Scene; index: number; asset: MediaAsset }[] = [];
  project.scenes.forEach((scene, index) => {
    const asset = getSceneMainVideoAsset(scene, project.mediaLibrary);
    if (asset?.audioLoudnessDb !== undefined && Number.isFinite(asset.audioLoudnessDb)) {
      entries.push({ scene, index, asset });
    }
  });
  if (entries.length < 2) return [];

  const med = median(entries.map((e) => e.asset.audioLoudnessDb as number));
  return entries.map(({ scene, index, asset }) => {
    const loudnessDb = asset.audioLoudnessDb as number;
    const deviationDb = loudnessDb - med;
    return {
      sceneId: scene.id,
      sceneIndex: index,
      mediaName: asset.name,
      loudnessDb,
      deviationDb,
      flagged: Math.abs(deviationDb) >= LOUDNESS_FLAG_THRESHOLD_DB,
    };
  });
}
