const fetch = require('node-fetch');

// 官方批量解析接口
const BATCH_PARSE_URL = 'https://stweb.youpengw.com/minipic/parse/batchParse';

/**
 * 调用官方批量解析，返回 { fullLink, videoId } 数组
 * @param {string[]} links - 短链接数组
 * @returns {Promise<{fullLink: string, videoId: string}[]>}
 */
async function batchParseLinks(links) {
  try {
    // 构造 urls 参数：每行 "索引|链接"
    const urlsBody = links
      .map((link, index) => `${index}|${link}`)
      .join('\n');

    const resp = await fetch(BATCH_PARSE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ urls: urlsBody }).toString()
    });
    const json = await resp.json();
    if (json.code !== 1) throw new Error('解析失败: ' + json.msg);
    const successList = json.data?.success_list || [];
    return successList.map(item => ({
      fullLink: `https://www.tiktok.com/@${item.uid}/video/${item.video_id}`,
      videoId: item.video_id || ''
    }));
  } catch (err) {
    console.error('官方解析接口调用失败:', err);
    return []; // 失败时返回空数组，让后续逻辑继续
  }
}

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
    // 1. 提取所有短链接
    const links = items.map(item => item.link);

    // 2. 调用官方批量解析
    const parsedResults = await batchParseLinks(links);

    // 3. 获取飞书 token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) throw new Error('飞书token失败: ' + tokenData.msg);
    const accessToken = tokenData.tenant_access_token;

    // 4. 构造飞书记录（合并解析结果）
    const records = items.map((item, idx) => ({
      fields: {
        '用户ID': userId,
        '视频ID': parsedResults[idx]?.videoId || '',
        '作品链接': parsedResults[idx]?.fullLink || item.link,
        '推流码': item.code,
        '素材语言': language,
        '视频类型': item.videoType
      }
    }));

    // 5. 写入飞书多维表格
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
