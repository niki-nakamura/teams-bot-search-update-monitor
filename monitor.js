/* monitor.js */
import fs from 'fs';
import fetch from 'node-fetch';
import { execSync } from 'child_process';

// Teams用Webhook URLに変更
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

const TARGET_USER_ID = '22046611'; // @googlesearchc の数値ID
const LATEST_ID_FILE = './latest_tweet_id.json';

/** (A) Teams向けカード形式メッセージを作成 */
function createTeamsCardMessage(tweet) {
  const tweetUrl = `https://x.com/googlesearchc/status/${tweet.id}`;
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "summary": "Google Search Central の更新",
    "themeColor": "0072C6",
    "title": "Google Search Central のツイート更新",
    "text": `Google Search Central のXアカウントが更新されました！\n\n詳細はこちら: [ツイートを確認する](${tweetUrl})`,
    "potentialAction": [
      {
        "@type": "OpenUri",
        "name": "X(Twitter)で詳細を見る",
        "targets": [
          { "os": "default", "uri": tweetUrl }
        ]
      }
    ]
  };
}

/** (B) Teamsへ送信 */
async function postToTeams(tweet) {
  const payload = createTeamsCardMessage(tweet);
  const res = await fetch(TEAMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Teams Webhook error: ${res.status} ${res.statusText}`);
  }
}

/** (C) 前回の最新IDをファイルから読み込み */
function getLatestTweetIdFromFile() {
  try {
    if (fs.existsSync(LATEST_ID_FILE)) {
      const data = fs.readFileSync(LATEST_ID_FILE, 'utf8');
      const json = JSON.parse(data);
      return json.latest_id;
    }
  } catch (error) {
    console.error('Error reading ID file:', error);
  }
  return null;
}

/** (D) 最新IDをファイルに書き込み、コミット＆プッシュ */
function saveLatestTweetIdToFile(tweetId) {
  try {
    fs.writeFileSync(LATEST_ID_FILE, JSON.stringify({ latest_id: tweetId }), 'utf8');
    console.log(`Wrote latest tweet ID to ${LATEST_ID_FILE}: ${tweetId}`);

    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');

    execSync(`git add ${LATEST_ID_FILE}`);
    execSync(`git commit -m "Update latest_tweet_id.json to ${tweetId} [skip ci]"`);
    execSync('git push');

    console.log('Pushed updated latest_tweet_id.json to the repository.');
  } catch (error) {
    console.error('Error writing ID file or pushing to repo:', error);
  }
}

/** (E) Twitter APIで最新ツイートを取得 */
async function fetchLatestTweet() {
  const url = `https://api.twitter.com/2/users/${TARGET_USER_ID}/tweets`
            + `?max_results=5`
            + `&tweet.fields=created_at,text`
            + `&expansions=attachments.media_keys`
            + `&media.fields=url,preview_image_url`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
    }
  });

  if (!res.ok) {
    throw new Error(`Twitter API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data || !data.data || data.data.length === 0) {
    return null;
  }

  const tweetObj = data.data[0];
  let mediaUrl = null;

  if (data.includes && data.includes.media && data.includes.media.length > 0) {
    const firstMedia = data.includes.media[0];
    mediaUrl = firstMedia.url || firstMedia.preview_image_url || null;
  }

  return {
    id: tweetObj.id,
    text: tweetObj.text,
    created_at: tweetObj.created_at,
    mediaUrl
  };
}

/** (F) メイン処理 */
(async function main() {
  try {
    const prevLatestId = getLatestTweetIdFromFile();
    const latestTweet = await fetchLatestTweet();

    if (!latestTweet) {
      console.log('No tweets found for the user.');
      return;
    }

    const currentLatestId = latestTweet.id;
    if (currentLatestId !== prevLatestId) {
      console.log('New tweet found! Sending to Teams...');
      await postToTeams(latestTweet);
      saveLatestTweetIdToFile(currentLatestId);
    } else {
      console.log('No new tweet since last check.');
    }
  } catch (error) {
    console.error('Error in monitoring:', error);
    process.exit(1);
  }
})();
