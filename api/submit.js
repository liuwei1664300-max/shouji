const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, language, items } = req.body;
  if (!userId || !language || !items || items.length === 0) {
    return res.status(400).json({ error: '数据不完整' });
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.tenant_access_token;

  const tableAppToken = process.env.BITABLE_APP_TOKEN;
  const tableId = process.env.TABLE_ID;

  const records = items.map(item => ({
    fields: {
      '用户ID': userId,
      '作品链接': item.link,
      '推流码': item.code,
      '素材语言': language,
      '视频类型': item.videoType   // 新增加，数字类型直接传入
    }
  }));

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
    return res.status(500).json({ error: result.msg });
  }
};
