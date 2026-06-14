const fetch = require('node-fetch');

// 你的隧道域名（每次重启 cloudflared 都会变，变了就改这里）
const PARSE_SERVICE_URL = 'https://creative-tagged-louise-msgstr.trycloudflare.com/expand';

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
    // 第一步：调用你的电脑解析短链接
    const expandResp = await fetch(PARSE_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: items.map(item => item.link) })
    });
    if (!expandResp.ok) {
      const errText = await expandResp.text();
      throw new Error('解析服务请求失败: ' + errText);
    }
    const expandData = await expandResp.json();

    // 将解析结果合并到 items
    const parsedItems = items.map((item, idx) => ({
      ...item,
      fullLink: expandData.results[idx]?.fullLink || item.link,
      videoId: expandData.results[idx]?.videoId || ''
    }));

    // 第二步：获取飞书 token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) throw new Error('飞书token失败: ' + tokenData.msg);
    const accessToken = tokenData.tenant_access_token;

    // 第三步：构造飞书记录
    const records = parsedItems.map(item => ({
      fields: {
        '用户ID': userId,
        '视频ID': item.videoId,
        '作品链接': item.fullLink,
        '推流码': item.code,
        '素材语言': language,
        '视频类型': item.videoType
      }
    }));

    // 第四步：写入飞书多维表格
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
