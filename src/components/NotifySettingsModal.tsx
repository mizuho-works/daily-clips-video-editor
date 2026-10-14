import { useState } from 'react';
import { getNotifySettings, saveNotifySettings, sendCompletionEmail, type NotifySettings } from '../utils/emailNotify';
import { getYoutubeSettings, preloadGoogleIdentity, saveYoutubeSettings } from '../utils/youtubeUpload';
import { CloseIcon } from './icons';

interface Props {
  onClose: () => void;
}

/**
 * 書き出し完了(または失敗)時のメール通知設定。EmailJS(https://www.emailjs.com/)を
 * 使う(Python版のGmail SMTP通知のWeb版代替、emailNotify.ts参照)。
 */
export function NotifySettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<NotifySettings>(() => getNotifySettings());
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [youtubeClientId, setYoutubeClientId] = useState(() => getYoutubeSettings().clientId);

  function update(patch: Partial<NotifySettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveNotifySettings(next);
  }

  async function handleTestSend() {
    setTestState('sending');
    setTestError('');
    // テスト送信は「有効にする」がオフでも試せるよう、一時的に有効化した設定で送る。
    // 送信中(特にEmailJSへの実際のネットワーク往復が発生する場合)にユーザーが他の
    // 項目を編集する可能性があるため、復元時は送信前の状態をそのまま書き戻すのではなく、
    // その時点の最新の設定に対してenabledだけを戻す(編集内容を上書きしないため)。
    const wasEnabled = settings.enabled;
    if (!wasEnabled) saveNotifySettings({ ...settings, enabled: true });
    const err = await sendCompletionEmail(
      '【デイリークリップス】テスト通知',
      'この通知が届いていれば、メール通知の設定は正しく動作しています。',
    );
    if (!wasEnabled) saveNotifySettings({ ...getNotifySettings(), enabled: false });
    if (err) {
      setTestState('error');
      setTestError(err);
    } else {
      setTestState('ok');
    }
  }

  return (
    <div className="media-flyout__backdrop" onClick={onClose}>
      <div className="media-flyout" onClick={(e) => e.stopPropagation()}>
        <div className="media-flyout__header">
          <h2>通知・YouTube設定</h2>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="media-flyout__body notify-settings">
          <label className="notify-settings__row">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            書き出し完了時にメールで通知する
          </label>

          <label className="notify-settings__field">
            通知先メールアドレス
            <input
              type="email"
              placeholder="example@gmail.com"
              value={settings.toEmail}
              onChange={(e) => update({ toEmail: e.target.value })}
            />
          </label>

          <label className="notify-settings__field">
            Service ID
            <input
              type="text"
              placeholder="service_xxxxxxx"
              value={settings.serviceId}
              onChange={(e) => update({ serviceId: e.target.value })}
            />
          </label>

          <label className="notify-settings__field">
            Template ID
            <input
              type="text"
              placeholder="template_xxxxxxx"
              value={settings.templateId}
              onChange={(e) => update({ templateId: e.target.value })}
            />
          </label>

          <label className="notify-settings__field">
            Public Key
            <input
              type="text"
              placeholder="公開キー"
              value={settings.publicKey}
              onChange={(e) => update({ publicKey: e.target.value })}
            />
          </label>

          <div className="notify-settings__actions">
            <button className="btn-pill" onClick={() => void handleTestSend()} disabled={testState === 'sending'}>
              {testState === 'sending' ? '送信中…' : 'テスト送信'}
            </button>
            {testState === 'ok' && <span className="notify-settings__status notify-settings__status--ok">送信できました</span>}
            {testState === 'error' && <span className="notify-settings__status notify-settings__status--error">送信失敗: {testError}</span>}
          </div>

          <h3 className="notify-settings__section-title">YouTubeへの自動アップロード</h3>
          <label className="notify-settings__field">
            GoogleのOAuthクライアントID
            <input
              type="text"
              placeholder="xxxxxxxx.apps.googleusercontent.com"
              value={youtubeClientId}
              onChange={(e) => {
                const clientId = e.target.value.trim();
                setYoutubeClientId(clientId);
                saveYoutubeSettings({ clientId });
                if (clientId) void preloadGoogleIdentity().catch(() => {});
              }}
            />
          </label>
          <p className="notify-settings__hint">
            設定すると、画面上部の<strong>「書き出し+YouTubeへ(非公開)」</strong>(スマホは↑アイコンのトグル)で、書き出し後にそのまま
            YouTubeへ<strong>非公開</strong>でアップロードされ、概要欄にYouTubeチャプターのテキストが入ります(普通の「MP4で書き出し」は今まで通りアップロードしません)。
            公開範囲は常に非公開で、変更はできません。<br />
            事前準備(Googleアカウントでの作業): ①Google Cloud Consoleでプロジェクトを作成し「YouTube Data API v3」を有効化
            ②OAuth同意画面を設定(テストユーザーに自分のアカウントを追加) ③認証情報から「OAuthクライアントID(ウェブアプリケーション)」を作成し、
            「承認済みのJavaScript生成元」に <code>https://amanosaaan.github.io</code> を追加 ④発行されたクライアントIDを上の欄に貼り付け。
            クライアントIDはこのブラウザにのみ保存されます(ログイン情報は保存せず、書き出しのたびにGoogleのログイン/許可の画面が出ます)。
            なお、YouTubeのAPIには1日あたりの利用上限があり、動画のアップロードは1日に数本までです。
          </p>

          <p className="notify-settings__hint">
            この機能を使うには、まず<strong>EmailJS(emailjs.com)</strong>に無料登録し、メール送信サービス(Gmail等)と
            テンプレートを作成してください。テンプレートでは <code>{'{{subject}}'}</code> と <code>{'{{message}}'}</code>{' '}
            を件名・本文に、<code>{'{{to_email}}'}</code> を宛先に使うよう設定します。作成後に発行される
            <strong>Service ID・Template ID・Public Key</strong>を上の欄に入力してください。
            <br />
            入力内容はこのブラウザのlocalStorageにのみ保存され、外部やこのアプリの開発元に送信されることはありません。
          </p>
        </div>
      </div>
    </div>
  );
}
