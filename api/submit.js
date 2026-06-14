const fetch = require('node-fetch');

// ---------- 短链接还原 + 提取视频ID ----------
async function expandShortLink(shortUrl) {
  try {
    const resp = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow',
      timeout: 5000
    });
    return resp.url; // 最终的长链接
  } catch (e) {
    // 如果 HEAD 失败，尝试 GET
    try {
      const resp2 = await fetch(shortUrl, {
        method: 'GET',
        redirect: 'follow',
        timeout: 5000
      });
      return resp2.url;
    } catch (e2) {
      return shortUrl; // 失败则保留原链接
    }
  }
}

function extractVideoId(url) {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : '';
}

// ---------- 主处理函数 ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, language, items } = req.body;
  if (!userId || !language || !items || items.length === 0) {
    return res.status(400).json({ error: '数据不完整' });
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const tableAppToken = process.env.BITABLE_APP_TOKEN;
  const tableId = process.env.TABLE_ID;

  try {
    // 1. 获取飞书 token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) throw new Error('飞书token失败: ' + tokenData.msg);
    const accessToken = tokenData.tenant_access_token;

    // 2. 处理每条记录：还原短链接 + 提取视频ID
    const records = [];
    for (const item of items) {
      const rawLink = item.link.trim();
      const fullLink = await expandShortLink(rawLink);
      const videoId = extractVideoId(fullLink);
      records.push({
        fields: {
          '用户ID': userId,
          '视频ID': videoId,
          '作品链接': fullLink,
          '推流码': item.code,
          '素材语言': language,
          '视频类型': item.videoType
        }
      });
    }

    // 3. 批量写入飞书多维表格
    const insertResp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${tableAppToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records })
      }
    );
    const result = await insertResp.json();
    if (result.code === 0) {
      return res.json({ msg: '提交成功' });
    } else {
      throw new Error('飞书写入失败: ' + result.msg);
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
