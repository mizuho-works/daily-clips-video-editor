import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

/**
 * 動画/音声素材のおおまかな音量(ラウドネス)を測定する。放送規格のLUFS等の厳密な
 * 測定ではなく、単純なRMS(実効値)ベースのdBFSを使う(0dBFS=デジタル最大振幅、
 * 値が大きい=0に近いほど音が大きく、マイナスが大きいほど音が小さい)。クリップ間の
 * 音量差を大まかに検知する用途(domain/audioLoudnessCheck.ts)には十分な精度。
 */

interface LoudnessAccumulator {
  sumSquares: number;
  sampleCount: number;
}

function accumulateSumSquares(buffer: AudioBuffer, acc: LoudnessAccumulator): void {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) acc.sumSquares += data[i] * data[i];
    acc.sampleCount += data.length;
  }
}

function accumulatorToDb(acc: LoudnessAccumulator): number | undefined {
  if (acc.sampleCount === 0) return undefined;
  const rms = Math.sqrt(acc.sumSquares / acc.sampleCount);
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

async function decodeViaWebAudio(blob: Blob): Promise<AudioBuffer | null> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
}

/**
 * iPhoneのApple Spatial Audio(apacコーデック)同梱動画等、decodeAudioDataが失敗する
 * ファイル向けのフォールバック(exportPipeline.tsの音声デコードと同じ考え方: 主音声
 * トラック(AAC)だけを明示的に選んでmediabunnyでデコードする)。
 */
async function decodeViaMediabunny(blob: Blob): Promise<LoudnessAccumulator | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack({ filter: (t) => t.canDecode() });
    if (!track) return null;
    const sink = new AudioBufferSink(track);
    const acc: LoudnessAccumulator = { sumSquares: 0, sampleCount: 0 };
    for await (const chunk of sink.buffers()) {
      accumulateSumSquares(chunk.buffer, acc);
    }
    return acc.sampleCount > 0 ? acc : null;
  } finally {
    input.dispose();
  }
}

export async function measureAudioLoudnessDb(blob: Blob): Promise<number | undefined> {
  try {
    const viaWebAudio = await decodeViaWebAudio(blob);
    if (viaWebAudio) {
      const acc: LoudnessAccumulator = { sumSquares: 0, sampleCount: 0 };
      accumulateSumSquares(viaWebAudio, acc);
      const db = accumulatorToDb(acc);
      if (db !== undefined) return db;
    }
    const viaMediabunny = await decodeViaMediabunny(blob);
    if (viaMediabunny) return accumulatorToDb(viaMediabunny);
    return undefined;
  } catch (err) {
    console.error('音量(ラウドネス)の解析に失敗しました(この動画の音量チェックはスキップします):', err);
    return undefined;
  }
}
