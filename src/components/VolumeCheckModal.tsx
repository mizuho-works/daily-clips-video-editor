import { analyzeSceneLoudness } from '../domain/audioLoudnessCheck';
import type { Project } from '../domain/types';
import { CloseIcon, WarningIcon } from './icons';

interface Props {
  project: Project;
  onClose: () => void;
  onSelectScene: (sceneId: string) => void;
}

/**
 * クリップ間の音量差(取り込み時にaudioLoudness.tsで解析した各動画の大まかな音量)を
 * チェックし、プロジェクト全体の中央値から極端に外れているシーンを一覧表示する。
 * 「動画全体で音量を大体同じにしたい」という要望に対し、まずは差を検知して
 * 気づけるようにするための機能(自動での音量調整は行わない。調整は各シーンの
 * 音量スライダー(ContextToolbar)で行う)。
 */
export function VolumeCheckModal({ project, onClose, onSelectScene }: Props) {
  const results = analyzeSceneLoudness(project);
  const flagged = results.filter((r) => r.flagged);
  // 極端なものを上に、それ以外は撮影順のまま参考として下に表示する。
  const sorted = [...results].sort((a, b) => Math.abs(b.deviationDb) - Math.abs(a.deviationDb));

  return (
    <div className="media-flyout__backdrop" onClick={onClose}>
      <div className="media-flyout" onClick={(e) => e.stopPropagation()}>
        <div className="media-flyout__header">
          <h2>音量チェック</h2>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="media-flyout__body">
          {results.length === 0 ? (
            <p className="youtube-chapters__hint">
              音声のある動画クリップが2本以上ないと、他と比べての音量差はチェックできません。
            </p>
          ) : (
            <>
              <p className="youtube-chapters__hint">
                各クリップの動画本体の音量を、プロジェクト全体の中央値と比べています。
                {flagged.length > 0
                  ? ` 他と比べて極端に大きい/小さいクリップが${flagged.length}件見つかりました。`
                  : ' 極端に外れているクリップはありませんでした。'}
                自動では調整しません — 気になるクリップを選んで、音量スライダーで調整してください。
              </p>
              <ul className="volume-check__list">
                {sorted.map((r) => (
                  <li key={r.sceneId} className={`volume-check__item${r.flagged ? ' is-flagged' : ''}`}>
                    <button className="volume-check__select" onClick={() => onSelectScene(r.sceneId)}>
                      {r.flagged && <WarningIcon size={16} />}
                      <span className="volume-check__scene-label">シーン{r.sceneIndex + 1}</span>
                      <span className="volume-check__media-name" title={r.mediaName}>
                        {r.mediaName}
                      </span>
                      <span className="volume-check__deviation">
                        {r.deviationDb >= 0 ? '+' : ''}
                        {r.deviationDb.toFixed(1)}dB
                        {r.flagged ? (r.deviationDb > 0 ? '(かなり大きい)' : '(かなり小さい)') : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
