/**
 * 書き出した動画を、YouTube(非公開)へ自動アップロードする。
 *
 * サーバーを持たない静的サイトのため、ブラウザから直接YouTube Data API v3を呼ぶ:
 * Google Identity Services(GIS)でOAuthのアクセストークンを取得し(スコープは
 * アップロードのみ)、再開可能アップロード(resumable upload)で動画本体を送る。
 * 公開範囲は常に「非公開(private)」固定(誤って公開しないため、設定で変えられない)。
 *
 * ユーザー自身がGoogle CloudでOAuthクライアントID(ウェブアプリ、承認済みの
 * JavaScript生成元にこのアプリのURLを登録)を作成し、このアプリの設定画面に
 * 入力する必要がある。クライアントIDは秘密情報ではなく(ブラウザに露出する前提の
 * 値)、このブラウザのlocalStorageにのみ保存する。アクセストークンは保存しない。
 */

const STORAGE_KEY = 'daily-clips-youtube-settings';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export interface YoutubeSettings {
  clientId: string;
}

export function getYoutubeSettings(): YoutubeSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { clientId: '' };
    return { clientId: '', ...JSON.parse(raw) };
  } catch {
    return { clientId: '' };
  }
}

export function saveYoutubeSettings(settings: YoutubeSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}
interface GoogleTokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => GoogleTokenClient;
    };
  };
}

function getGoogle(): GoogleGlobal | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google;
}

let gisPromise: Promise<void> | null = null;

/**
 * GISのスクリプトを先に読み込んでおく。ログインのポップアップは「ユーザー操作(クリック)の
 * 呼び出しスタック内」で開かないとポップアップブロッカーに止められるため、クリックの
 * 時点でまだ読み込み中だと困る。設定画面を開いた時・エディタ表示時に呼んで先読みする。
 */
export function preloadGoogleIdentity(): Promise<void> {
  if (getGoogle()?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisPromise = null;
        reject(new Error('Googleのログイン用スクリプトを読み込めませんでした(ネットワークを確認してください)'));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

export type TokenResult = { token: string } | { error: string };

/**
 * アクセストークンを取得する(Googleのログイン/許可ポップアップが開く)。
 * 必ずクリック等のユーザー操作の呼び出しスタック内から(awaitより前に)呼ぶこと。
 */
export function requestYoutubeAccessToken(clientId: string): Promise<TokenResult> {
  return new Promise<TokenResult>((resolve) => {
    const google = getGoogle();
    if (!google?.accounts?.oauth2) {
      resolve({ error: 'Googleのログイン用スクリプトがまだ読み込まれていません。少し待ってからもう一度お試しください' });
      return;
    }
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (response) => {
          if (response.access_token) resolve({ token: response.access_token });
          else resolve({ error: response.error_description || response.error || 'ログインに失敗しました' });
        },
        error_callback: (error) => {
          resolve({ error: error.type === 'popup_closed' ? 'ログインのポップアップが閉じられました' : error.message || error.type || 'ログインに失敗しました' });
        },
      });
      client.requestAccessToken();
    } catch (err) {
      resolve({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export interface YoutubeUploadParams {
  blob: Blob;
  title: string;
  description: string;
  accessToken: string;
  onProgress?: (ratio: number) => void;
}

/** 非公開でアップロードし、動画IDを返す。 */
export async function uploadVideoToYoutube({ blob, title, description, accessToken, onProgress }: YoutubeUploadParams): Promise<string> {
  // YouTube側の制約: タイトルは100文字まで、"<"や">"は使えない。
  const safeTitle = (title || 'デイリークリップス').replace(/[<>]/g, '').slice(0, 100);
  const safeDescription = description.replace(/[<>]/g, '');
  const metadata = {
    snippet: { title: safeTitle, description: safeDescription, categoryId: '22' },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  };

  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(blob.size),
      'X-Upload-Content-Type': blob.type || 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) {
    throw new Error(`アップロードの開始に失敗しました(${init.status}): ${await init.text().catch(() => '')}`);
  }
  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) throw new Error('アップロード先のURLを取得できませんでした');

  // fetchはアップロードの進捗を取れないため、本体の送信だけXMLHttpRequestを使う。
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', blob.type || 'video/mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const id = (JSON.parse(xhr.responseText) as { id?: string }).id;
          if (id) resolve(id);
          else reject(new Error('アップロードは完了しましたが動画IDを取得できませんでした'));
        } catch {
          reject(new Error('アップロード結果を解釈できませんでした'));
        }
      } else {
        reject(new Error(`アップロードに失敗しました(${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('アップロード中にネットワークエラーが発生しました'));
    xhr.send(blob);
  });
}

export function youtubeStudioUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

export interface YoutubeUploadStatus {
  text: string;
  /** アップロード成功時、YouTube Studioで開くためのURL。 */
  url?: string;
  isError?: boolean;
}

/**
 * 書き出し完了後の一連の流れ(ログイン結果の待ち受け→アップロード→進捗/結果の通知)。
 * 失敗しても書き出し自体は成功扱いのままにするため、例外は投げずに状態で返す。
 * 成功時は動画のURLを返す(メール通知に載せるため)。
 */
export async function uploadExportedVideo(params: {
  tokenPromise: Promise<TokenResult>;
  blob: Blob;
  title: string;
  description: string;
  onStatus: (status: YoutubeUploadStatus) => void;
}): Promise<string | null> {
  const { tokenPromise, blob, title, description, onStatus } = params;
  const tokenResult = await tokenPromise;
  if ('error' in tokenResult) {
    onStatus({ text: `YouTubeへのアップロードを中止しました: ${tokenResult.error}`, isError: true });
    return null;
  }
  try {
    onStatus({ text: 'YouTubeへアップロード中… 0%' });
    const videoId = await uploadVideoToYoutube({
      blob,
      title,
      description,
      accessToken: tokenResult.token,
      onProgress: (ratio) => onStatus({ text: `YouTubeへアップロード中… ${Math.round(ratio * 100)}%` }),
    });
    const url = youtubeStudioUrl(videoId);
    onStatus({ text: 'YouTubeへ非公開でアップロードしました', url });
    return url;
  } catch (err) {
    console.error('YouTubeへのアップロードに失敗しました(書き出し自体は成功しています):', err);
    onStatus({ text: `YouTubeへのアップロードに失敗しました: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    return null;
  }
}
